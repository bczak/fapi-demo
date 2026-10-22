import { describe, expect, it } from "vitest";
import { mergeCartChanges } from "./changes";
import type { CartChanges, CartItem, PriceChange } from "./store";

const repriced = (productId: number, oldPriceMinor: number, newPriceMinor: number): PriceChange => ({
  productId,
  name: `Product ${productId}`,
  oldPriceMinor,
  newPriceMinor,
});

const line = (productId: number): CartItem => ({
  productId,
  name: `Product ${productId}`,
  priceMinor: 10_000,
  quantity: 1,
});

const changes = (repricedLines: PriceChange[], removed: CartItem[] = []): CartChanges => ({
  repriced: repricedLines,
  removed,
});

describe("mergeCartChanges", () => {
  it("shows what a check found when nothing is on show", () => {
    const found = changes([repriced(1, 10_000, 12_000)]);
    expect(mergeCartChanges(undefined, found)).toBe(found);
  });

  it("keeps what is on show next to what a newer check found about other products", () => {
    const shown = changes([repriced(1, 10_000, 12_000)]);
    const found = changes([repriced(2, 10_000, 9_000)], [line(3)]);
    expect(mergeCartChanges(shown, found)).toEqual(
      changes([repriced(1, 10_000, 12_000), repriced(2, 10_000, 9_000)], [line(3)]),
    );
  });

  it("changes nothing when the same changes come twice, e.g. from a shared check", () => {
    const shown = changes([repriced(1, 10_000, 12_000)], [line(2)]);
    expect(mergeCartChanges(shown, shown)).toEqual(shown);
  });

  it("shows a product repriced twice from the price before the first change to the latest", () => {
    const merged = mergeCartChanges(
      changes([repriced(1, 10_000, 12_000)]),
      changes([repriced(1, 12_000, 13_000)]),
    );
    expect(merged).toEqual(changes([repriced(1, 10_000, 13_000)]));
  });

  it("drops a price that went back to what the customer saw, and shows nothing once nothing is left", () => {
    const back = mergeCartChanges(
      changes([repriced(1, 10_000, 12_000)]),
      changes([repriced(1, 12_000, 10_000)]),
    );
    expect(back).toBeUndefined();
  });

  it("says only that a product is gone once it was removed after a price change", () => {
    const merged = mergeCartChanges(changes([repriced(1, 10_000, 12_000)]), changes([], [line(1)]));
    expect(merged).toEqual(changes([], [line(1)]));
  });

  it("forgets that a product was removed once it is back in the cart at a new price", () => {
    const merged = mergeCartChanges(changes([], [line(1)]), changes([repriced(1, 10_000, 11_000)]));
    expect(merged).toEqual(changes([repriced(1, 10_000, 11_000)]));
  });
});
