import type { Customer, Product } from "@fapi/shared";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshCart } from "@/features/place-order";
import { completeAttempt } from "@/features/place-order/model/idempotency";
import { cartLines, cartWith } from "@/test/cart";
import {
  catalogue,
  checkedIds,
  deferred,
  firstAnswerFrom,
  type Handler,
  postedOrders,
  sentKeys,
  stubFetch,
} from "@/test/fetch";
import { customer, order, product, rates } from "@/test/fixtures";
import { renderWithClient } from "@/test/render";
import { ProductGrid } from "@/widgets/product-grid";
import { CartSheet } from "./CartSheet";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const SHIPPING_LABELS: [keyof Customer, string][] = [
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["street", "Street and number"],
  ["city", "City"],
  ["zip", "ZIP"],
];

const failure = () => Response.json({ message: "Out of stock" }, { status: 503 });
const placed =
  (id = "order-1") =>
  () =>
    Response.json(order(id), { status: 201 });
const payButton = () => screen.getByRole("button", { name: /^Pay / });
const notice = () => screen.queryByRole("alert");

/** The shop's catalogue in these tests; a test changes it to change what the API answers. */
let shelf: Product[];
/** False: GET /api/rates fails, as when ČNB is down and the API has no rates cached. */
let ratesUp: boolean;

function setup(...responses: Array<() => Response | Promise<Response>>) {
  return serve(catalogue(shelf), ...responses);
}

/** The grid and the sheet over an API answering GET /api/products with `products`. */
function serve(products: Handler, ...responses: Array<() => Response | Promise<Response>>) {
  const placeOrder = vi.fn<() => Response | Promise<Response>>();
  for (const response of responses) placeOrder.mockImplementationOnce(response);
  const fetchMock = stubFetch({
    "GET /api/products": products,
    "GET /api/rates": () =>
      ratesUp
        ? Response.json(rates)
        : Response.json({ message: "Exchange rates are currently unavailable" }, { status: 502 }),
    "POST /api/orders": placeOrder,
  });
  const view = renderWithClient(
    <>
      <ProductGrid />
      <CartSheet />
    </>,
  );
  return { fetchMock, ...view };
}

/** Adds every product of the grid to the cart. */
async function addAll(user: UserEvent) {
  for (const add of await screen.findAllByRole("button", { name: "Add to cart" })) await user.click(add);
}

const openCart = (user: UserEvent) => user.click(screen.getByRole("button", { name: /^Open cart/ }));

/** Adds the products, then goes from the review step through shipping (filled with `person`) to payment. */
async function toPaymentStep(user: UserEvent, person: Customer = customer) {
  await addAll(user);
  await openCart(user);
  await fillShipping(user, person);
  await screen.findByRole("button", { name: /^Pay / });
}

/** From the review step through shipping (filled with `person`) to the payment step. */
async function fillShipping(user: UserEvent, person: Customer = customer) {
  await user.click(screen.getByRole("button", { name: "Continue to shipping" }));
  for (const [field, label] of SHIPPING_LABELS) await user.type(screen.getByLabelText(label), person[field]);
  await user.click(screen.getByRole("button", { name: "Continue to payment" }));
}

async function closeCart(user: UserEvent) {
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

async function chooseEur(user: UserEvent) {
  const eur = screen.getByRole("radio", { name: /EUR/ });
  await waitFor(() => expect(eur).toBeEnabled());
  await user.click(eur);
}

beforeEach(() => {
  completeAttempt();
  cartWith();
  shelf = [product(1)];
  ratesUp = true;
});

describe("checkout in the cart sheet", () => {
  it("stays on the payment step after a failure, then a retry with the same key places the order", async () => {
    const { user, fetchMock } = setup(failure, placed("order-9"));
    await toPaymentStep(user);

    await user.click(payButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Out of stock", expect.anything()));
    expect(screen.getByRole("heading", { name: "Payment" })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(cartLines()).toEqual([[1, 1]]);

    await user.click(payButton());
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/thank-you/$orderId", params: { orderId: "order-9" } }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(cartLines()).toEqual([]);
    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("keeps the key when the customer goes back to shipping and forward again", async () => {
    const { user, fetchMock } = setup(failure, placed());
    await toPaymentStep(user);
    await user.click(payButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    await user.click(await screen.findByRole("button", { name: /^Pay / }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("keeps the chosen currency, and so the key, when the customer goes back and forward again", async () => {
    const { user, fetchMock } = setup(failure, placed());
    await toPaymentStep(user);
    await chooseEur(user);
    await user.click(payButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    expect(await screen.findByRole("radio", { name: /EUR/ })).toBeChecked();
    await user.click(await screen.findByRole("button", { name: /^Pay / }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(postedOrders(fetchMock).map((o) => o.currency)).toEqual(["EUR", "EUR"]);
    const keys = sentKeys(fetchMock);
    expect(keys[1]).toBe(keys[0]);
  });

  it("keeps the key when the retry only drops a space the server trims anyway", async () => {
    const { user, fetchMock } = setup(failure, placed());
    await toPaymentStep(user, { ...customer, firstName: `${customer.firstName} ` });
    await user.click(payButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.clear(screen.getByLabelText("First name"));
    await user.type(screen.getByLabelText("First name"), customer.firstName);
    await user.click(screen.getByRole("button", { name: "Continue to payment" }));
    await user.click(await screen.findByRole("button", { name: /^Pay / }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("after a reload, fills in the customer and currency of the order sent without an answer, and keeps its key", async () => {
    const { user, fetchMock } = setup(
      () => Promise.reject(new TypeError("Failed to fetch")),
      placed("order-5"),
    );
    await toPaymentStep(user);
    await chooseEur(user);
    await user.click(payButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    // The reload: a new page with fresh modules, where only the web storage carries over.
    cleanup();
    vi.resetModules();
    const reloaded = await import("./CartSheet");
    const { user: again } = renderWithClient(<reloaded.CartSheet />);
    await again.click(screen.getByRole("button", { name: /^Open cart/ }));
    await again.click(screen.getByRole("button", { name: "Continue to shipping" }));
    for (const [field, label] of SHIPPING_LABELS) {
      expect(screen.getByLabelText(label)).toHaveValue(customer[field]);
    }
    await again.click(screen.getByRole("button", { name: "Continue to payment" }));
    expect(screen.getByRole("radio", { name: /EUR/ })).toBeChecked();
    await again.click(await screen.findByRole("button", { name: /^Pay / }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/thank-you/$orderId", params: { orderId: "order-5" } }),
    );
    expect(postedOrders(fetchMock).map((o) => o.currency)).toEqual(["EUR", "EUR"]);
    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("after a reload without exchange rates, retries the order sent in EUR without an answer, with its key", async () => {
    const { user, fetchMock } = setup(
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Response.json(order("order-5"), { status: 200 }),
    );
    await toPaymentStep(user);
    await chooseEur(user);
    await user.click(payButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    ratesUp = false;
    cleanup();
    vi.resetModules();
    const reloaded = await import("./CartSheet");
    const { user: again } = renderWithClient(<reloaded.CartSheet />);
    await again.click(screen.getByRole("button", { name: /^Open cart/ }));
    await again.click(screen.getByRole("button", { name: "Continue to shipping" }));
    await again.click(screen.getByRole("button", { name: "Continue to payment" }));

    const retry = await screen.findByRole("button", { name: "Retry payment" });
    expect(screen.getByRole("radio", { name: /EUR/ })).toBeChecked();
    await again.click(retry);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/thank-you/$orderId", params: { orderId: "order-5" } }),
    );
    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("locks the cart controls on the page and on the payment step while the order is sent", async () => {
    const response = deferred<Response>();
    const { user } = setup(() => response.promise);
    await toPaymentStep(user);

    await user.click(payButton());

    // The page behind the open sheet is hidden from assistive technology, hence `hidden`.
    const cartControls = () =>
      ["Decrease quantity of Product 1", "Increase quantity of Product 1", "Remove Product 1"].map((name) =>
        screen.getByRole("button", { name, hidden: true }),
      );
    for (const control of cartControls()) expect(control).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Placing order…" })).toBeDisabled();

    response.resolve(failure());
    await waitFor(() => expect(payButton()).toBeEnabled());
    for (const control of cartControls()) expect(control).toBeEnabled();
  });
});

describe("cart sheet: exchange rates", () => {
  it("starts loading them as soon as the cart opens, before the payment step", async () => {
    const { user, fetchMock } = setup();
    await addAll(user);
    const ratesRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/rates"));
    expect(ratesRequests()).toHaveLength(0);

    await openCart(user);

    await waitFor(() => expect(ratesRequests()).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Continue to shipping" })).toBeInTheDocument();
  });
});

describe("cart sheet: prices that changed after the products were added", () => {
  it("shows the new price when the sheet opens", async () => {
    const { user } = setup();
    await addAll(user);
    shelf[0] = { ...product(1), priceMinor: 12_000 };

    await openCart(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Product 1: 100\sKč → 120\sKč each/);
    expect(screen.getByText(/^120\sKč each$/)).toBeInTheDocument();
    // 120 Kč + 21 % VAT.
    expect(screen.getByText(/^145,20\sKč$/)).toBeInTheDocument();
  });

  it("does not send an order whose price changed on the way to Pay; paying the new total sends it", async () => {
    const { user, fetchMock } = setup(placed("order-2"));
    await toPaymentStep(user);
    expect(notice()).not.toBeInTheDocument();
    shelf[0] = { ...product(1), priceMinor: 12_000 };

    await user.click(payButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/Product 1: 100\sKč → 120\sKč each/);
    expect(payButton()).toHaveTextContent(/^Pay 145,20\sKč$/);
    expect(postedOrders(fetchMock)).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();

    await user.click(payButton());

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/thank-you/$orderId", params: { orderId: "order-2" } }),
    );
    expect(postedOrders(fetchMock)).toHaveLength(1);
  });

  it("takes out a product that no longer exists, says so, and orders the rest when paid again", async () => {
    shelf.push(product(2));
    const { user, fetchMock } = setup(placed());
    await toPaymentStep(user);
    shelf.pop();

    await user.click(payButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Product 2 is no longer available and was removed.",
    );
    expect(cartLines()).toEqual([[1, 1]]);
    expect(postedOrders(fetchMock)).toHaveLength(0);

    await user.click(payButton());

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(postedOrders(fetchMock)[0]?.items).toEqual([{ productId: 1, quantity: 1 }]);
  });

  it("keeps a change the customer has not confirmed when the sheet is closed and opened again", async () => {
    const { user, fetchMock } = setup(placed());
    await toPaymentStep(user);
    shelf[0] = { ...product(1), priceMinor: 12_000 };
    await user.click(payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Product 1: 100\sKč → 120\sKč each/);

    await closeCart(user);
    await openCart(user);
    // The check of the reopened sheet is over, and found nothing new.
    await act(async () => {
      await refreshCart();
    });

    expect(notice()).toHaveTextContent(/Product 1: 100\sKč → 120\sKč each/);
    expect(postedOrders(fetchMock)).toHaveLength(0);

    await user.click(payButton());

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    // 120 Kč + 21 % VAT, as on the Pay button the customer pressed.
    expect(postedOrders(fetchMock)[0]?.expectedTotalMinor).toBe(14_520);
  });

  it("shows the change, not an error, when a price changes between the check and the order (409)", async () => {
    const { user, fetchMock } = setup(() => {
      shelf[0] = { ...product(1), priceMinor: 12_000 };
      return Response.json({ message: "Prices have changed", code: "price_changed" }, { status: 409 });
    }, placed("order-6"));
    await toPaymentStep(user);
    expect(payButton()).toHaveTextContent(/^Pay 121\sKč$/);

    await user.click(payButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/Product 1: 100\sKč → 120\sKč each/);
    expect(payButton()).toHaveTextContent(/^Pay 145,20\sKč$/);
    expect(toast.error).not.toHaveBeenCalled();

    await user.click(payButton());

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/thank-you/$orderId", params: { orderId: "order-6" } }),
    );
    expect(postedOrders(fetchMock).map((o) => o.expectedTotalMinor)).toEqual([12_100, 14_520]);
    const keys = sentKeys(fetchMock);
    expect(keys[1]).toBe(keys[0]);
  });

  it("checks the whole cart again when a product was added while the last check hung", async () => {
    // The grid still shows product 2 at 100 Kč; the catalogue already asks 150 Kč.
    const current = [product(1), { ...product(2), priceMinor: 15_000 }];
    const firstCheck = deferred<Response>();
    const checks = firstAnswerFrom(firstCheck.promise, current);
    const products: Handler = (url, init) =>
      url.searchParams.has("ids") ? checks(url, init) : catalogue([product(1), product(2)])(url, init);
    cartWith([1, 1]);
    const { user, fetchMock } = serve(products, placed("order-4"));

    await openCart(user);
    await closeCart(user);
    await user.click(await screen.findByRole("button", { name: "Add to cart" }));
    await openCart(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(/Product 2: 100\sKč → 150\sKč each/);
    await fillShipping(user);
    // 100 Kč + 150 Kč, with 21 % VAT.
    expect(await screen.findByRole("button", { name: /^Pay / })).toHaveTextContent(/^Pay 302,50\sKč$/);

    await user.click(payButton());

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(postedOrders(fetchMock)[0]).toMatchObject({
      items: [
        { productId: 1, quantity: 1 },
        { productId: 2, quantity: 1 },
      ],
      expectedTotalMinor: 30_250,
    });
    expect(checkedIds(fetchMock)).toEqual(["1", "1,2", "1,2"]);

    // The overtaken first check answers only now, after the order: it must not bring the confirmed notice back.
    await act(async () => {
      firstCheck.resolve(Response.json({ items: [product(1)], total: 1 }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await openCart(user);
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument();
    expect(notice()).not.toBeInTheDocument();
  });

  it("adds a later change to one the customer has not confirmed yet", async () => {
    shelf.push(product(2));
    const { user } = setup();
    await addAll(user);
    shelf[0] = { ...product(1), priceMinor: 12_000 };
    await openCart(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Product 1: 100\sKč → 120\sKč each/);
    await closeCart(user);

    shelf[1] = { ...product(2), priceMinor: 15_000 };
    await openCart(user);

    await waitFor(() => expect(notice()).toHaveTextContent(/Product 2: 100\sKč → 150\sKč each/));
    expect(notice()).toHaveTextContent(/Product 1: 100\sKč → 120\sKč each/);
  });

  it("still says why when the cart is left empty", async () => {
    const { user } = setup();
    await addAll(user);
    shelf.pop();

    await openCart(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Product 1 is no longer available and was removed.",
    );
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument();
    expect(cartLines()).toEqual([]);
  });
});
