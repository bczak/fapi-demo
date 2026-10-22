import {
  createOrderSchema,
  type OrderItemInput,
  orderSnapshotSchema,
  type PaymentCurrency,
  type Product,
} from "@fapi/shared";
import { act, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCartStore } from "@/entities/cart";
import { cartLines, cartWith } from "@/test/cart";
import {
  catalogue,
  deferred,
  firstAnswerFrom,
  type Handler,
  hang,
  postedOrders,
  sentKeys,
  stubFetch,
} from "@/test/fetch";
import { customer, order, product, rates } from "@/test/fixtures";
import { renderWithClient } from "@/test/render";
import { completeAttempt, idempotencyKeyFor } from "../model/idempotency";
import { PaymentStep } from "./PaymentStep";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const onBack = vi.fn();
const onPlaced = vi.fn();
const onCartChange = vi.fn();
const failure = () => Response.json({ message: "Out of stock" }, { status: 500 });
const KEPT = { description: "Your cart is kept, you can try again." };

const payButton = () => screen.getByRole("button", { name: /^Pay / });
const isKey = (value: unknown) => createOrderSchema.shape.idempotencyKey.safeParse(value).success;

/** The step with the currency kept above it, as the cart sheet keeps it. */
function Checkout({ initial = "CZK" }: { initial?: PaymentCurrency }) {
  const [currency, setCurrency] = useState(initial);
  return (
    <PaymentStep
      customer={customer}
      currency={currency}
      onCurrencyChange={setCurrency}
      onCartChange={onCartChange}
      onBack={onBack}
      onPlaced={onPlaced}
    />
  );
}

function setup(...responses: Handler[]) {
  return setupWith([product(1), product(2)], ...responses);
}

/** The step over an API whose catalogue holds `shelf`. */
function setupWith(shelf: Product[], ...responses: Handler[]) {
  return serve({ products: catalogue(shelf) }, ...responses);
}

interface Api {
  products: Handler;
  rates?: Handler;
  /** The currency the checkout starts in. */
  currency?: PaymentCurrency;
}

/** The step over an API answering products and rates with these handlers, and orders with `responses`. */
function serve(
  { products, rates: ratesAnswer = () => Response.json(rates), currency }: Api,
  ...responses: Handler[]
) {
  const placeOrder = vi.fn<Handler>();
  for (const response of responses) placeOrder.mockImplementationOnce(response);
  const fetchMock = stubFetch({
    "GET /api/products": products,
    "GET /api/rates": ratesAnswer,
    "POST /api/orders": placeOrder,
  });
  const view = renderWithClient(<Checkout initial={currency} />);
  return { fetchMock, ...view };
}

beforeEach(() => {
  completeAttempt();
  cartWith([1, 2], [2, 1]);
});

afterEach(() => vi.restoreAllMocks());

describe("PaymentStep: a failed order", () => {
  it("stays on the step, keeps the cart and shows the server message", async () => {
    const { user } = setup(failure);

    await user.click(payButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Out of stock", KEPT));
    expect(onPlaced).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(cartLines()).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(payButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
  });

  it("shows a connection message instead of the browser's 'Failed to fetch'", async () => {
    const { user } = setup(() => Promise.reject(new TypeError("Failed to fetch")));

    await user.click(payButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Check your connection"),
        expect.anything(),
      ),
    );
    expect(onPlaced).not.toHaveBeenCalled();
  });

  it("gives up when the server does not answer in time, says so and unlocks everything", async () => {
    // Stands in for the 15 s timer: the test fires it.
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const { user, fetchMock } = setup(hang);

    await user.click(payButton());
    await waitFor(() => expect(postedOrders(fetchMock)).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Placing order…" })).toBeDisabled();
    act(() => timeout.abort(new DOMException("signal timed out", "TimeoutError")));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The server did not answer in time.", KEPT));
    expect(payButton()).toBeEnabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(useCartStore.getState().submitting).toBe(false);
    expect(cartLines()).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(onPlaced).not.toHaveBeenCalled();
  });

  it("shows the conflict (409) and retries with a new key", async () => {
    const message = "This idempotency key was already used for a different order";
    const { user, fetchMock } = setup(
      () => Response.json({ message }, { status: 409 }),
      () => Response.json(order(), { status: 201 }),
    );

    await user.click(payButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message, KEPT));
    await user.click(payButton());

    await waitFor(() => expect(onPlaced).toHaveBeenCalledOnce());
    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(isKey(keys[1])).toBe(true);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("does not take a malformed answer for a placed order", async () => {
    const { user } = setup(() => Response.json({ ...order(), payment: null }, { status: 201 }));

    await user.click(payButton());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Unexpected response from the server", KEPT),
    );
    expect(onPlaced).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(cartLines()).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it("is retried with the same idempotency key, then leaves the cart and goes to the thank-you page", async () => {
    const { user, fetchMock } = setup(failure, () => Response.json(order("order-7"), { status: 200 }));

    await user.click(payButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await user.click(payButton());

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/thank-you/$orderId", params: { orderId: "order-7" } }),
    );
    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(isKey(keys[0])).toBe(true);
    expect(keys[1]).toBe(keys[0]);
    expect(onPlaced).toHaveBeenCalledOnce();
    expect(cartLines()).toEqual([]);
  });

  it("is retried with a new key once the cart has changed", async () => {
    const { user, fetchMock } = setup(failure, () => Response.json(order(), { status: 201 }));

    await user.click(payButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    act(() => useCartStore.getState().setQuantity(1, 3));
    await user.click(payButton());

    await waitFor(() => expect(onPlaced).toHaveBeenCalled());
    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
    expect(postedOrders(fetchMock)[1]?.items).toEqual([
      { productId: 1, quantity: 3 },
      { productId: 2, quantity: 1 },
    ]);
  });
});

describe("PaymentStep: a placed order", () => {
  it("sends the customer, the chosen currency and the cart lines", async () => {
    const { user, fetchMock } = setup(() => Response.json(order(), { status: 201 }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /EUR/ })).toBeEnabled());

    await user.click(screen.getByRole("radio", { name: /EUR/ }));
    await user.click(payButton());

    await waitFor(() => expect(onPlaced).toHaveBeenCalled());
    expect(postedOrders(fetchMock)).toEqual([
      {
        customer,
        currency: "EUR",
        items: [
          { productId: 1, quantity: 2 },
          { productId: 2, quantity: 1 },
        ],
        // The CZK total incl. VAT on screen: 3 × 100 Kč + 21 %.
        expectedTotalMinor: 36_300,
        idempotencyKey: expect.any(String),
      },
    ]);
  });

  it("takes only the ordered quantities out of the cart", async () => {
    const response = deferred<Response>();
    const { user } = setup(() => response.promise);

    await user.click(payButton());
    // Changes made behind the locked controls, e.g. through the store, must survive the order.
    act(() => useCartStore.getState().add(product(1)));
    await act(async () => response.resolve(Response.json(order(), { status: 201 })));

    await waitFor(() => expect(onPlaced).toHaveBeenCalled());
    expect(cartLines()).toEqual([[1, 1]]);
  });
});

describe("PaymentStep: a price changed since the products were added", () => {
  it("sends nothing and shows the new total; paying it sends the order", async () => {
    const { user, fetchMock } = setupWith([{ ...product(1), priceMinor: 15_000 }, product(2)], () =>
      Response.json(order(), { status: 201 }),
    );
    // 2 × 100 Kč + 100 Kč, then 2 × 150 Kč + 100 Kč, each with 21 % VAT.
    expect(payButton()).toHaveTextContent(/^Pay 363\sKč$/);

    await user.click(payButton());

    await waitFor(() =>
      expect(onCartChange).toHaveBeenLastCalledWith({
        repriced: [{ productId: 1, name: "Product 1", oldPriceMinor: 10_000, newPriceMinor: 15_000 }],
        removed: [],
      }),
    );
    expect(payButton()).toHaveTextContent(/^Pay 484\sKč$/);
    expect(postedOrders(fetchMock)).toHaveLength(0);
    expect(onPlaced).not.toHaveBeenCalled();

    await user.click(payButton());

    await waitFor(() => expect(onPlaced).toHaveBeenCalledOnce());
    expect(onCartChange).toHaveBeenLastCalledWith(undefined);
    expect(postedOrders(fetchMock)).toHaveLength(1);
  });
});

describe("PaymentStep: the server refuses the total, as a price changed after the check (409 price_changed)", () => {
  it("shows the change instead of an error, and paying the new total sends the order with the same key", async () => {
    const first = Promise.resolve(Response.json({ items: [product(1), product(2)], total: 2 }));
    const { user, fetchMock } = serve(
      { products: firstAnswerFrom(first, [{ ...product(1), priceMinor: 15_000 }, product(2)]) },
      () => Response.json({ message: "Prices have changed", code: "price_changed" }, { status: 409 }),
      () => Response.json(order(), { status: 201 }),
    );

    await user.click(payButton());

    await waitFor(() =>
      expect(onCartChange).toHaveBeenLastCalledWith({
        repriced: [{ productId: 1, name: "Product 1", oldPriceMinor: 10_000, newPriceMinor: 15_000 }],
        removed: [],
      }),
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(payButton()).toHaveTextContent(/^Pay 484\sKč$/);

    await user.click(payButton());

    await waitFor(() => expect(onPlaced).toHaveBeenCalledOnce());
    expect(postedOrders(fetchMock).map((o) => o.expectedTotalMinor)).toEqual([36_300, 48_400]);
    const keys = sentKeys(fetchMock);
    expect(keys[1]).toBe(keys[0]);
  });
});

describe("PaymentStep: without exchange rates, after a reload", () => {
  const ratesDown = () =>
    Response.json({ message: "Exchange rates are currently unavailable" }, { status: 502 });
  /** The order the page sent in EUR before the reload, without an answer: the cart as it is now. */
  const sentBefore = (items: OrderItemInput[]) =>
    idempotencyKeyFor(
      orderSnapshotSchema.parse({ customer, currency: "EUR", items, expectedTotalMinor: 36_300 }),
    );
  const cartItems = [
    { productId: 1, quantity: 2 },
    { productId: 2, quantity: 1 },
  ];

  it("offers to retry the order sent without an answer, with its key, and goes to its thank-you page", async () => {
    const key = sentBefore(cartItems);
    const { user, fetchMock } = serve(
      { products: catalogue([product(1), product(2)]), rates: ratesDown, currency: "EUR" },
      () => Response.json(order("order-3"), { status: 200 }),
    );

    const retry = await screen.findByRole("button", { name: "Retry payment" });
    expect(retry).toBeEnabled();
    expect(screen.getByRole("radio", { name: /EUR/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /EUR/ })).toBeEnabled();
    expect(screen.getByText(/the amount is shown once the order is confirmed/)).toBeInTheDocument();

    await user.click(retry);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/thank-you/$orderId", params: { orderId: "order-3" } }),
    );
    expect(sentKeys(fetchMock)).toEqual([key]);
    expect(postedOrders(fetchMock)[0]?.currency).toBe("EUR");
  });

  it("shows the server's message when the order never got through and needs the rates after all", async () => {
    sentBefore(cartItems);
    const { user } = serve(
      { products: catalogue([product(1), product(2)]), rates: ratesDown, currency: "EUR" },
      () => Response.json({ message: "Exchange rates are currently unavailable" }, { status: 502 }),
    );

    await user.click(await screen.findByRole("button", { name: "Retry payment" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Exchange rates are currently unavailable", KEPT),
    );
    expect(onPlaced).not.toHaveBeenCalled();
  });

  it("waits for the exchange rates before offering it, as they may still give a quote", async () => {
    sentBefore(cartItems);
    serve({ products: catalogue([product(1), product(2)]), rates: hang, currency: "EUR" });

    expect(await screen.findByRole("radio", { name: /EUR/ })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Retry payment" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place order" })).toBeDisabled();
  });

  it("does not offer it for another order than the one sent, which needs the rates", async () => {
    sentBefore([{ productId: 1, quantity: 2 }]);
    serve({ products: catalogue([product(1), product(2)]), rates: ratesDown, currency: "EUR" });

    expect(await screen.findByText(/you can still pay in CZK/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place order" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /EUR/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Retry payment" })).not.toBeInTheDocument();
  });
});

describe("PaymentStep: while the exchange rates load", () => {
  it("shows a spinner instead of the EUR and USD prices, without greying them out, then the prices", async () => {
    const answer = deferred<Response>();
    serve({ products: catalogue([product(1), product(2)]), rates: () => answer.promise });

    expect(await screen.findByRole("status")).toHaveTextContent("Loading the live ČNB exchange rates…");
    expect(screen.getAllByText("Loading rate…")).toHaveLength(2);
    const eurRow = screen.getByRole("radio", { name: /EUR/ }).closest("label");
    expect(eurRow).not.toHaveClass("has-disabled:opacity-50");
    expect(screen.getByRole("group")).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      answer.resolve(Response.json(rates));
    });

    await waitFor(() => expect(screen.queryByText("Loading rate…")).not.toBeInTheDocument());
    expect(screen.getByRole("radio", { name: /EUR/ })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("group")).toHaveAttribute("aria-busy", "false");
  });
});

describe("PaymentStep: while the request is pending", () => {
  it("locks the cart, the currencies, Back and Pay, and sends one request only", async () => {
    const response = deferred<Response>();
    const { user, fetchMock } = setup(() => response.promise);
    await waitFor(() => expect(screen.getByRole("radio", { name: /EUR/ })).toBeEnabled());

    await user.click(payButton());

    const pay = screen.getByRole("button", { name: "Placing order…" });
    expect(pay).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(useCartStore.getState().submitting).toBe(true);
    await waitFor(() => expect(postedOrders(fetchMock)).toHaveLength(1));
    await user.click(pay);
    expect(postedOrders(fetchMock)).toHaveLength(1);

    await act(async () => response.resolve(failure()));
    await waitFor(() => expect(payButton()).toBeEnabled());
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(useCartStore.getState().submitting).toBe(false);
  });
});
