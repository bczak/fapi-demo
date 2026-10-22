import { createOrderSchema } from "@fapi/shared";
import { act, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCartStore } from "@/entities/cart";
import { cartLines, cartWith } from "@/test/cart";
import { deferred, type Handler, hang, postedOrders, sentKeys, stubFetch } from "@/test/fetch";
import { customer, order, product, rates } from "@/test/fixtures";
import { renderWithClient } from "@/test/render";
import { completeAttempt } from "../model/idempotency";
import { PaymentStep } from "./PaymentStep";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const onBack = vi.fn();
const onPlaced = vi.fn();
const failure = () => Response.json({ message: "Out of stock" }, { status: 500 });
const KEPT = { description: "Your cart is kept, you can try again." };

const payButton = () => screen.getByRole("button", { name: /^Pay / });
const isKey = (value: unknown) => createOrderSchema.shape.idempotencyKey.safeParse(value).success;

function setup(...responses: Handler[]) {
  const placeOrder = vi.fn<Handler>();
  for (const response of responses) placeOrder.mockImplementationOnce(response);
  const fetchMock = stubFetch({
    "GET /api/rates": () => Response.json(rates),
    "POST /api/orders": placeOrder,
  });
  const view = renderWithClient(<PaymentStep customer={customer} onBack={onBack} onPlaced={onPlaced} />);
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
    await user.click(pay);
    expect(postedOrders(fetchMock)).toHaveLength(1);

    await act(async () => response.resolve(failure()));
    await waitFor(() => expect(payButton()).toBeEnabled());
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(useCartStore.getState().submitting).toBe(false);
  });
});
