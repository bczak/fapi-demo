import { type CreateOrderInput, createOrderSchema, type Order, orderSchema } from "@fapi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCartStore } from "@/entities/cart";
import { ApiError, ApiTimeoutError, api } from "@/shared/api/client";
import { cartLines, cartWith } from "@/test/cart";
import { type Handler, hang, sentKeys, stubFetch } from "@/test/fetch";
import { customer, order as makeOrder } from "@/test/fixtures";
import { completeAttempt, type OrderSnapshot } from "./idempotency";
import { submitOrder } from "./submitOrder";

const snapshot: OrderSnapshot = { customer, currency: "CZK", items: [{ productId: 1, quantity: 2 }] };

const order = makeOrder("9b2c3a64-3f0e-4c5e-8a39-0d7c2f9c1a11");

const newSend = () => vi.fn<(input: CreateOrderInput) => Promise<Order>>();
const keyOf = (send: ReturnType<typeof newSend>, call: number) => send.mock.calls[call]?.[0].idempotencyKey;

describe("submitOrder", () => {
  beforeEach(() => {
    completeAttempt();
    cartWith([1, 2]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("sends the snapshot with an idempotency key the API accepts", async () => {
    const send = newSend().mockResolvedValue(order);
    await expect(submitOrder(snapshot, send)).resolves.toBe(order);
    expect(send).toHaveBeenCalledOnce();
    expect(createOrderSchema.safeParse(send.mock.calls[0]?.[0]).success).toBe(true);
    expect(send.mock.calls[0]?.[0]).toMatchObject(snapshot);
  });

  it("locks the cart while the request is in flight and unlocks it afterwards", async () => {
    let finish: (placed: Order) => void = () => {};
    const send = newSend().mockImplementation(
      () =>
        new Promise<Order>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = submitOrder(snapshot, send);
    expect(useCartStore.getState().submitting).toBe(true);
    finish(order);
    await pending;
    expect(useCartStore.getState().submitting).toBe(false);
  });

  it("removes only the submitted quantities on success", async () => {
    cartWith([1, 3], [2, 1]);
    await submitOrder(snapshot, newSend().mockResolvedValue(order));
    expect(cartLines()).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it("keeps the cart, unlocks it and rejects when the request fails", async () => {
    const send = newSend().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(submitOrder(snapshot, send)).rejects.toThrow("Failed to fetch");
    expect(cartLines()).toEqual([[1, 2]]);
    expect(useCartStore.getState().submitting).toBe(false);
  });

  it("retries the same snapshot with the same key and clears the cart once it succeeds", async () => {
    const send = newSend().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(order);
    await expect(submitOrder(snapshot, send)).rejects.toThrow("boom");
    await submitOrder(snapshot, send);
    expect(keyOf(send, 1)).toBe(keyOf(send, 0));
    expect(cartLines()).toEqual([]);
  });

  it("keeps the key after other API errors, so a retry cannot place the order twice", async () => {
    const send = newSend().mockRejectedValueOnce(new ApiError(503, "Unavailable")).mockResolvedValue(order);
    await expect(submitOrder(snapshot, send)).rejects.toThrow("Unavailable");
    await submitOrder(snapshot, send);
    expect(keyOf(send, 1)).toBe(keyOf(send, 0));
  });

  it("starts a new attempt when the server has the key for a different order (409)", async () => {
    const conflict = new ApiError(409, "This idempotency key was already used for a different order");
    const send = newSend().mockRejectedValueOnce(conflict).mockResolvedValue(order);
    await expect(submitOrder(snapshot, send)).rejects.toBe(conflict);
    expect(cartLines()).toEqual([[1, 2]]);
    expect(useCartStore.getState().submitting).toBe(false);

    await submitOrder(snapshot, send);
    expect(keyOf(send, 1)).not.toBe(keyOf(send, 0));
    expect(createOrderSchema.safeParse(send.mock.calls[1]?.[0]).success).toBe(true);
  });

  it("uses a new key when the snapshot changed since the failed request", async () => {
    const send = newSend().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(order);
    await expect(submitOrder(snapshot, send)).rejects.toThrow("boom");
    await submitOrder({ ...snapshot, items: [{ productId: 1, quantity: 3 }] }, send);
    expect(keyOf(send, 1)).not.toBe(keyOf(send, 0));
  });

  it("uses a new key for the next order after a success", async () => {
    const send = newSend().mockResolvedValue(order);
    await submitOrder(snapshot, send);
    cartWith([1, 2]);
    await submitOrder(snapshot, send);
    expect(keyOf(send, 1)).not.toBe(keyOf(send, 0));
  });
});

describe("submitOrder over the API client", () => {
  beforeEach(() => {
    completeAttempt();
    cartWith([1, 2]);
  });

  const send = (input: CreateOrderInput) =>
    api("/orders", orderSchema, { method: "POST", body: input, timeoutMs: 20 });

  function serve(...responses: Handler[]) {
    const placeOrder = vi.fn<Handler>();
    for (const response of responses) placeOrder.mockImplementationOnce(response);
    return stubFetch({ "POST /api/orders": placeOrder });
  }

  it("accepts the existing order (200) the API returns when the first request got through", async () => {
    const fetchMock = serve(
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Response.json(order, { status: 200 }),
    );

    await expect(submitOrder(snapshot, send)).rejects.toThrow("Failed to fetch");
    await expect(submitOrder(snapshot, send)).resolves.toEqual(order);

    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(cartLines()).toEqual([]);
  });

  it("releases the cart when the server never answers, and the retry keeps the key", async () => {
    const fetchMock = serve(hang, () => Response.json(order, { status: 200 }));

    await expect(submitOrder(snapshot, send)).rejects.toThrow(ApiTimeoutError);
    expect(useCartStore.getState().submitting).toBe(false);
    expect(cartLines()).toEqual([[1, 2]]);

    await submitOrder(snapshot, send);
    const keys = sentKeys(fetchMock);
    expect(keys[1]).toBe(keys[0]);
  });
});
