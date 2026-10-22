import { screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeAttempt } from "@/features/place-order/model/idempotency";
import { cartLines, cartWith } from "@/test/cart";
import { deferred, sentKeys, stubFetch } from "@/test/fetch";
import { customer, order, product, rates } from "@/test/fixtures";
import { renderWithClient } from "@/test/render";
import { ProductGrid } from "@/widgets/product-grid";
import { CartSheet } from "./CartSheet";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const SHIPPING_FIELDS = [
  ["First name", customer.firstName],
  ["Last name", customer.lastName],
  ["Email", customer.email],
  ["Phone", customer.phone],
  ["Street and number", customer.street],
  ["City", customer.city],
  ["ZIP", customer.zip],
] as const;

const failure = () => Response.json({ message: "Out of stock" }, { status: 503 });
const payButton = () => screen.getByRole("button", { name: /^Pay / });

function setup(...responses: Array<() => Response | Promise<Response>>) {
  const placeOrder = vi.fn<() => Response | Promise<Response>>();
  for (const response of responses) placeOrder.mockImplementationOnce(response);
  const fetchMock = stubFetch({
    "GET /api/products": () => Response.json({ items: [product(1)], total: 1 }),
    "GET /api/rates": () => Response.json(rates),
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

/** Add the product, open the cart and click through review and shipping to the payment step. */
async function toPaymentStep(user: UserEvent) {
  await user.click(await screen.findByRole("button", { name: "Add to cart" }));
  await user.click(screen.getByRole("button", { name: /^Open cart/ }));
  await user.click(screen.getByRole("button", { name: "Continue to shipping" }));
  for (const [label, value] of SHIPPING_FIELDS) await user.type(screen.getByLabelText(label), value);
  await user.click(screen.getByRole("button", { name: "Continue to payment" }));
  await screen.findByRole("button", { name: /^Pay / });
}

beforeEach(() => {
  completeAttempt();
  cartWith();
});

describe("checkout in the cart sheet", () => {
  it("stays on the payment step after a failure, then a retry with the same key places the order", async () => {
    const { user, fetchMock } = setup(failure, () => Response.json(order("order-9"), { status: 201 }));
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
    const { user, fetchMock } = setup(failure, () => Response.json(order(), { status: 201 }));
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
