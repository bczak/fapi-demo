import { MAX_QUANTITY, type Product } from "@fapi/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { cartLines, cartWith } from "@/test/cart";
import { product } from "@/test/fixtures";
import { useCartStore } from "./store";

beforeEach(() => {
  useCartStore.setState({ items: [], submitting: false });
});

describe("cart store: add", () => {
  it("adds a product with quantity 1 and counts up when it is added again", () => {
    useCartStore.getState().add(product(1));
    expect(cartLines()).toEqual([[1, 1]]);
    useCartStore.getState().add(product(1));
    useCartStore.getState().add(product(2));
    expect(cartLines()).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it("stops at the maximum quantity", () => {
    for (let i = 0; i < MAX_QUANTITY + 5; i++) useCartStore.getState().add(product(1));
    expect(cartLines()).toEqual([[1, MAX_QUANTITY]]);
  });
});

describe("cart store: setQuantity", () => {
  it("sets the quantity of one line only", () => {
    cartWith([1, 1], [2, 1]);
    useCartStore.getState().setQuantity(1, 5);
    expect(cartLines()).toEqual([
      [1, 5],
      [2, 1],
    ]);
  });

  it("clamps to the maximum quantity", () => {
    cartWith([1, 1]);
    useCartStore.getState().setQuantity(1, MAX_QUANTITY + 1);
    expect(cartLines()).toEqual([[1, MAX_QUANTITY]]);
  });

  it("never goes below 1, removing a line is remove()", () => {
    cartWith([1, 3]);
    useCartStore.getState().setQuantity(1, 0);
    expect(cartLines()).toEqual([[1, 1]]);
    useCartStore.getState().setQuantity(1, -4);
    expect(cartLines()).toEqual([[1, 1]]);
  });
});

describe("cart store: remove", () => {
  it("removes the line and keeps the others", () => {
    cartWith([1, 2], [2, 1]);
    useCartStore.getState().remove(1);
    expect(cartLines()).toEqual([[2, 1]]);
  });
});

describe("cart store: removeOrdered", () => {
  it("removes the lines that were ordered completely", () => {
    cartWith([1, 2], [2, 1]);
    useCartStore.getState().removeOrdered([
      { productId: 1, quantity: 2 },
      { productId: 2, quantity: 1 },
    ]);
    expect(cartLines()).toEqual([]);
  });

  it("keeps the quantity that was added after the order was submitted", () => {
    cartWith([1, 3]);
    useCartStore.getState().removeOrdered([{ productId: 1, quantity: 2 }]);
    expect(cartLines()).toEqual([[1, 1]]);
  });

  it("keeps products that were not part of the order", () => {
    cartWith([1, 1], [2, 4]);
    useCartStore.getState().removeOrdered([{ productId: 1, quantity: 1 }]);
    expect(cartLines()).toEqual([[2, 4]]);
  });

  it("ignores ordered products that are no longer in the cart", () => {
    cartWith([2, 4]);
    useCartStore.getState().removeOrdered([{ productId: 1, quantity: 1 }]);
    expect(cartLines()).toEqual([[2, 4]]);
  });
});

describe("cart store: syncProducts", () => {
  const priced = (id: number, priceMinor: number) => ({ ...product(id), priceMinor });
  const sync = (checked: number[], products: Product[]) =>
    useCartStore.getState().syncProducts(checked, products);

  it("takes over a new price and reports it with the old one", () => {
    cartWith([1, 2], [2, 1]);
    expect(sync([1, 2], [priced(1, 12_000), product(2)])).toEqual({
      repriced: [{ productId: 1, name: "Product 1", oldPriceMinor: 10_000, newPriceMinor: 12_000 }],
      removed: [],
    });
    expect(useCartStore.getState().items.map((i) => i.priceMinor)).toEqual([12_000, 10_000]);
    expect(cartLines()).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it("removes a line whose product no longer exists and reports it", () => {
    cartWith([1, 2], [2, 1]);
    const [, gone] = useCartStore.getState().items;
    expect(sync([1, 2], [product(1)])).toEqual({ repriced: [], removed: [gone] });
    expect(cartLines()).toEqual([[1, 2]]);
  });

  it("takes over a new name without reporting it, as it does not change the price", () => {
    cartWith([1, 1]);
    expect(sync([1], [{ ...product(1), name: "Renamed" }])).toBeUndefined();
    expect(useCartStore.getState().items[0]?.name).toBe("Renamed");
  });

  it("keeps lines that were not checked, e.g. added while the check was in flight", () => {
    cartWith([1, 1], [2, 1]);
    expect(sync([1], [product(1)])).toBeUndefined();
    expect(cartLines()).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it("leaves the cart untouched when nothing changed", () => {
    cartWith([1, 1], [2, 3]);
    const { items } = useCartStore.getState();
    expect(sync([1, 2], [product(2), product(1)])).toBeUndefined();
    expect(useCartStore.getState().items).toBe(items);
  });
});

describe("cart store: submitting flag", () => {
  it("is off by default and can be switched", () => {
    expect(useCartStore.getState().submitting).toBe(false);
    useCartStore.getState().setSubmitting(true);
    expect(useCartStore.getState().submitting).toBe(true);
  });

  it("is not persisted, so a reload cannot leave the cart locked", () => {
    useCartStore.getState().add(product(1));
    useCartStore.getState().setSubmitting(true);
    const saved: unknown = JSON.parse(localStorage.getItem("cart") ?? "{}");
    expect(saved).toEqual({ state: { items: useCartStore.getState().items }, version: expect.any(Number) });
  });
});
