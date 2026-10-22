import type { CartChanges, PriceChange } from "./store";

/**
 * The changes on show, not confirmed yet, followed by the ones a newer check found. A product repriced
 * twice keeps the price it had before the first change (and leaves the list once it is back at it);
 * a product removed or repriced again replaces what was said about it before.
 * Merging the same changes twice changes nothing. Undefined when nothing is left to show.
 */
export function mergeCartChanges(
  shown: CartChanges | undefined,
  found: CartChanges,
): CartChanges | undefined {
  if (!shown) return found;
  const mentioned = new Set([...found.repriced, ...found.removed].map((c) => c.productId));
  const removed = [...shown.removed.filter((i) => !mentioned.has(i.productId)), ...found.removed];

  const gone = new Set(found.removed.map((i) => i.productId));
  const byProduct = new Map<number, PriceChange>();
  for (const change of [...shown.repriced, ...found.repriced]) {
    const first = byProduct.get(change.productId);
    byProduct.set(change.productId, first ? { ...change, oldPriceMinor: first.oldPriceMinor } : change);
  }
  const repriced = [...byProduct.values()].filter(
    (c) => !gone.has(c.productId) && c.oldPriceMinor !== c.newPriceMinor,
  );

  return repriced.length || removed.length ? { repriced, removed } : undefined;
}
