import {
  type CreateOrderInput,
  createOrderSchema,
  type Order,
  orderSchema,
  type Product,
} from "@fapi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCartStore } from "@/entities/cart";
import { ApiError, ApiTimeoutError, api } from "@/shared/api/client";
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
import { customer, order as makeOrder, product } from "@/test/fixtures";
import { completeAttempt } from "./idempotency";
import { type ConfirmedOrder, submitOrder } from "./submitOrder";

// 2 × 100 Kč + 21 % VAT.
const snapshot: ConfirmedOrder = {
  customer,
  currency: "CZK",
  items: [{ productId: 1, quantity: 2 }],
  expectedTotalMinor: 24_200,
};

const order = makeOrder("9b2c3a64-3f0e-4c5e-8a39-0d7c2f9c1a11");

const newSend = () => vi.fn<(input: CreateOrderInput) => Promise<Order>>();
const keyOf = (send: ReturnType<typeof newSend>, call: number) => send.mock.calls[call]?.[0].idempotencyKey;

describe("submitOrder", () => {
  beforeEach(() => {
    completeAttempt();
    cartWith([1, 2]);
    stubFetch({ "GET /api/products": catalogue([product(1), product(2)]) });
  });

  afterEach(() => vi.restoreAllMocks());

  it("sends the snapshot with an idempotency key the API accepts", async () => {
    const send = newSend().mockResolvedValue(order);
    await expect(submitOrder(snapshot, send)).resolves.toEqual({ order });
    expect(send).toHaveBeenCalledOnce();
    expect(createOrderSchema.safeParse(send.mock.calls[0]?.[0]).success).toBe(true);
    expect(send.mock.calls[0]?.[0]).toMatchObject(snapshot);
  });

  it("locks the cart while the request is in flight and unlocks it afterwards", async () => {
    const response = deferred<Order>();
    const send = newSend().mockReturnValue(response.promise);
    const pending = submitOrder(snapshot, send);
    expect(useCartStore.getState().submitting).toBe(true);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(useCartStore.getState().submitting).toBe(true);
    response.resolve(order);
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

describe("submitOrder reads the snapshot as the API does", () => {
  const padded = { ...customer, firstName: `${customer.firstName} `, city: `  ${customer.city}` };

  beforeEach(() => {
    completeAttempt();
    cartWith([1, 2]);
    stubFetch({ "GET /api/products": catalogue([product(1)]) });
  });

  it("sends the customer trimmed", async () => {
    const send = newSend().mockResolvedValue(order);
    await submitOrder({ ...snapshot, customer: padded }, send);
    expect(send.mock.calls[0]?.[0].customer).toEqual(customer);
  });

  it("keeps the key when a retry only drops spaces the API trims, as the server takes it for the same order", async () => {
    const send = newSend().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(order);
    await expect(submitOrder({ ...snapshot, customer: padded }, send)).rejects.toThrow("Failed to fetch");
    await submitOrder(snapshot, send);
    expect(keyOf(send, 1)).toBe(keyOf(send, 0));
  });
});

describe("submitOrder checks the cart against the catalogue first", () => {
  let shelf: Product[];

  beforeEach(() => {
    completeAttempt();
    cartWith([1, 2], [2, 1]);
    shelf = [product(1), product(2)];
  });

  const both: ConfirmedOrder = {
    ...snapshot,
    items: [
      { productId: 1, quantity: 2 },
      { productId: 2, quantity: 1 },
    ],
    expectedTotalMinor: 36_300,
  };

  it("sends nothing when a price changed and returns the change; paying again sends the order", async () => {
    shelf[0] = { ...product(1), priceMinor: 12_000 };
    stubFetch({ "GET /api/products": catalogue(shelf) });
    const send = newSend().mockResolvedValue(order);

    await expect(submitOrder(both, send)).resolves.toEqual({
      changes: {
        repriced: [{ productId: 1, name: "Product 1", oldPriceMinor: 10_000, newPriceMinor: 12_000 }],
        removed: [],
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect(useCartStore.getState().items[0]?.priceMinor).toBe(12_000);
    expect(useCartStore.getState().submitting).toBe(false);

    await expect(submitOrder(both, send)).resolves.toEqual({ order });
    expect(send).toHaveBeenCalledOnce();
  });

  it("sends nothing when a product is gone, and takes it out of the cart", async () => {
    stubFetch({ "GET /api/products": catalogue([product(1)]) });
    const send = newSend().mockResolvedValue(order);

    const result = await submitOrder(both, send);

    expect(result).toEqual({
      changes: { repriced: [], removed: [expect.objectContaining({ productId: 2 })] },
    });
    expect(send).not.toHaveBeenCalled();
    expect(cartLines()).toEqual([[1, 2]]);
  });

  it("keeps the cart locked while it checks", async () => {
    const response = deferred<Response>();
    stubFetch({ "GET /api/products": () => response.promise });
    const pending = submitOrder(both, newSend().mockResolvedValue(order));
    expect(useCartStore.getState().submitting).toBe(true);
    response.resolve(Response.json({ items: shelf, total: 2 }));
    await pending;
    expect(useCartStore.getState().submitting).toBe(false);
  });

  const priceChanged = new ApiError(409, "Prices have changed since you confirmed the order.", [], {
    code: "price_changed",
  });

  it("shows the change and keeps the key when the server refuses the confirmed total (409 price_changed)", async () => {
    // The price changes between the check and the order.
    const first = Promise.resolve(Response.json({ items: shelf, total: 2 }));
    stubFetch({
      "GET /api/products": firstAnswerFrom(first, [{ ...product(1), priceMinor: 12_000 }, product(2)]),
    });
    const send = newSend().mockRejectedValueOnce(priceChanged).mockResolvedValue(order);

    await expect(submitOrder(both, send)).resolves.toEqual({
      changes: {
        repriced: [{ productId: 1, name: "Product 1", oldPriceMinor: 10_000, newPriceMinor: 12_000 }],
        removed: [],
      },
    });
    expect(useCartStore.getState().items[0]?.priceMinor).toBe(12_000);
    expect(useCartStore.getState().submitting).toBe(false);

    // Nothing was placed: paying the new total (2 × 120 Kč + 100 Kč, with VAT) goes out with the same key.
    await expect(submitOrder({ ...both, expectedTotalMinor: 41_140 }, send)).resolves.toEqual({ order });
    expect(keyOf(send, 1)).toBe(keyOf(send, 0));
    expect(send.mock.calls[1]?.[0].expectedTotalMinor).toBe(41_140);
  });

  it("passes the refusal on, with the key kept, when the check after it finds nothing to show", async () => {
    stubFetch({ "GET /api/products": catalogue(shelf) });
    const send = newSend().mockRejectedValueOnce(priceChanged).mockResolvedValue(order);

    await expect(submitOrder(both, send)).rejects.toBe(priceChanged);
    expect(useCartStore.getState().submitting).toBe(false);

    await submitOrder(both, send);
    expect(keyOf(send, 1)).toBe(keyOf(send, 0));
  });

  it("retries the order sent without an answer even while the catalogue is down, as the server knows it", async () => {
    stubFetch({ "GET /api/products": catalogue(shelf) });
    const send = newSend().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(order);
    await expect(submitOrder(both, send)).rejects.toThrow("Failed to fetch");

    stubFetch({ "GET /api/products": () => Promise.reject(new TypeError("Failed to fetch")) });
    await expect(submitOrder(both, send)).resolves.toEqual({ order });

    expect(send).toHaveBeenCalledTimes(2);
    expect(keyOf(send, 1)).toBe(keyOf(send, 0));
  });

  it("shows a price change the server finds when that retry was never placed", async () => {
    stubFetch({ "GET /api/products": catalogue(shelf) });
    const send = newSend()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(priceChanged)
      .mockResolvedValue(order);
    await expect(submitOrder(both, send)).rejects.toThrow("Failed to fetch");
    shelf[0] = { ...product(1), priceMinor: 12_000 };
    stubFetch({ "GET /api/products": catalogue(shelf) });

    await expect(submitOrder(both, send)).resolves.toEqual({
      changes: {
        repriced: [{ productId: 1, name: "Product 1", oldPriceMinor: 10_000, newPriceMinor: 12_000 }],
        removed: [],
      },
    });
    expect(keyOf(send, 1)).toBe(keyOf(send, 0));
  });

  it("sends nothing and keeps the cart when the check fails", async () => {
    stubFetch({ "GET /api/products": () => Promise.reject(new TypeError("Failed to fetch")) });
    const send = newSend().mockResolvedValue(order);
    await expect(submitOrder(both, send)).rejects.toThrow("Failed to fetch");
    expect(send).not.toHaveBeenCalled();
    expect(cartLines()).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(useCartStore.getState().submitting).toBe(false);
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
    return stubFetch({ "GET /api/products": catalogue([product(1)]), "POST /api/orders": placeOrder });
  }

  it("accepts the existing order (200) the API returns when the first request got through", async () => {
    const fetchMock = serve(
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Response.json(order, { status: 200 }),
    );

    await expect(submitOrder(snapshot, send)).rejects.toThrow("Failed to fetch");
    await expect(submitOrder(snapshot, send)).resolves.toEqual({ order });

    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(cartLines()).toEqual([]);
  });

  it("tells a refused total (409 price_changed) from a key conflict: shows the change, keeps the key", async () => {
    const placeOrder = vi
      .fn<Handler>()
      .mockImplementationOnce(() =>
        Response.json({ message: "Prices have changed", code: "price_changed" }, { status: 409 }),
      )
      .mockImplementation(() => Response.json(order, { status: 201 }));
    const first = Promise.resolve(Response.json({ items: [product(1)], total: 1 }));
    const fetchMock = stubFetch({
      "GET /api/products": firstAnswerFrom(first, [{ ...product(1), priceMinor: 12_000 }]),
      "POST /api/orders": placeOrder,
    });

    await expect(submitOrder(snapshot, send)).resolves.toEqual({
      changes: {
        repriced: [{ productId: 1, name: "Product 1", oldPriceMinor: 10_000, newPriceMinor: 12_000 }],
        removed: [],
      },
    });
    // 2 × 120 Kč + 21 % VAT.
    await expect(submitOrder({ ...snapshot, expectedTotalMinor: 29_040 }, send)).resolves.toEqual({ order });

    const keys = sentKeys(fetchMock);
    expect(keys[1]).toBe(keys[0]);
    expect(postedOrders(fetchMock).map((o) => o.expectedTotalMinor)).toEqual([24_200, 29_040]);
  });

  it("still starts a new attempt after a key conflict (409 idempotency_conflict)", async () => {
    const conflict = { message: "This idempotency key was already used", code: "idempotency_conflict" };
    const fetchMock = serve(
      () => Response.json(conflict, { status: 409 }),
      () => Response.json(order, { status: 201 }),
    );

    await expect(submitOrder(snapshot, send)).rejects.toMatchObject({ status: 409, ...conflict });
    await submitOrder(snapshot, send);

    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
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
