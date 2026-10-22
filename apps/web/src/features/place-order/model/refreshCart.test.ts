import { beforeEach, describe, expect, it } from "vitest";
import { useCartStore } from "@/entities/cart";
import { cartLines, cartWith } from "@/test/cart";
import { catalogue, checkedIds, deferred, firstAnswerFrom, stubFetch } from "@/test/fetch";
import { product } from "@/test/fixtures";
import { refreshCart } from "./refreshCart";

const productRequests = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([input]) => new URL(String(input), "http://localhost").search);

beforeEach(() => {
  cartWith([2, 1], [1, 3]);
});

describe("refreshCart", () => {
  it("asks the API for the cart's products and reports nothing when they are unchanged", async () => {
    const fetchMock = stubFetch({ "GET /api/products": catalogue([product(1), product(2)]) });
    await expect(refreshCart()).resolves.toBeUndefined();
    expect(productRequests(fetchMock)).toEqual(["?ids=2,1"]);
  });

  it("takes over the current prices and drops products that no longer exist", async () => {
    stubFetch({ "GET /api/products": catalogue([{ ...product(1), priceMinor: 9_900 }]) });

    const changes = await refreshCart();

    expect(changes?.repriced).toEqual([
      { productId: 1, name: "Product 1", oldPriceMinor: 10_000, newPriceMinor: 9_900 },
    ]);
    expect(changes?.removed.map((i) => i.productId)).toEqual([2]);
    expect(useCartStore.getState().items).toEqual([
      { productId: 1, name: "Product 1", priceMinor: 9_900, quantity: 3 },
    ]);
  });

  it("does not call the API for an empty cart", async () => {
    cartWith();
    const fetchMock = stubFetch({});
    await expect(refreshCart()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shares a check in flight, so every caller gets its changes", async () => {
    const response = deferred<Response>();
    const fetchMock = stubFetch({ "GET /api/products": () => response.promise });

    const first = refreshCart();
    const second = refreshCart();
    response.resolve(Response.json({ items: [product(1)], total: 1 }));

    const changes = await first;
    expect(changes?.removed.map((i) => i.productId)).toEqual([2]);
    await expect(second).resolves.toBe(changes);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps a product added while the check is in flight", async () => {
    const response = deferred<Response>();
    stubFetch({ "GET /api/products": () => response.promise });

    const check = refreshCart();
    useCartStore.getState().add(product(3));
    response.resolve(Response.json({ items: [product(1), product(2)], total: 2 }));

    await expect(check).resolves.toBeUndefined();
    expect(cartLines()).toEqual([
      [2, 1],
      [1, 3],
      [3, 1],
    ]);
  });

  it("does not share a check that misses a product added since, so Pay never goes ahead on it", async () => {
    cartWith([1, 1]);
    const first = deferred<Response>();
    const shelf = [product(1), { ...product(2), priceMinor: 15_000 }];
    const fetchMock = stubFetch({ "GET /api/products": firstAnswerFrom(first.promise, shelf) });

    void refreshCart();
    // Added from a grid that still shows the old price.
    useCartStore.getState().add(product(2));
    const changes = await refreshCart();

    expect(checkedIds(fetchMock)).toEqual(["1", "1,2"]);
    expect(changes?.repriced).toEqual([
      { productId: 2, name: "Product 2", oldPriceMinor: 10_000, newPriceMinor: 15_000 },
    ]);
    expect(useCartStore.getState().items[1]?.priceMinor).toBe(15_000);
  });

  it("leaves the reporting to the newer check when one was overtaken, and never applies its older prices", async () => {
    cartWith([1, 1]);
    const first = deferred<Response>();
    const shelf = [{ ...product(1), priceMinor: 12_000 }, product(2)];
    stubFetch({ "GET /api/products": firstAnswerFrom(first.promise, shelf) });

    const older = refreshCart();
    useCartStore.getState().add(product(2));
    const newer = await refreshCart();
    // The first answer, from before the price change, comes in last.
    first.resolve(Response.json({ items: [product(1)], total: 1 }));

    await expect(older).resolves.toBeUndefined();
    expect(newer?.repriced.map((c) => c.newPriceMinor)).toEqual([12_000]);
    expect(useCartStore.getState().items.map((i) => i.priceMinor)).toEqual([12_000, 10_000]);
  });

  it("still shares a check of the same products after one left and came back", async () => {
    const response = deferred<Response>();
    const fetchMock = stubFetch({ "GET /api/products": () => response.promise });

    const first = refreshCart();
    useCartStore.getState().remove(2);
    useCartStore.getState().add(product(2));
    const second = refreshCart();
    response.resolve(Response.json({ items: [product(1), product(2)], total: 2 }));

    await expect(second).resolves.toBe(await first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("checks again once the last check is over", async () => {
    const fetchMock = stubFetch({ "GET /api/products": catalogue([product(1), product(2)]) });
    await refreshCart();
    await refreshCart();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
