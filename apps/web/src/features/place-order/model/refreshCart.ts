import { type CartChanges, useCartStore } from "@/entities/cart";
import { fetchProductsByIds } from "@/entities/product";

/** One look-up of the cart's products in the catalogue. */
class Check {
  /** Started because the cart no longer held these products: its answer replaces this one's. */
  next: Check | undefined;
  readonly result: Promise<CartChanges | undefined>;

  constructor(
    readonly key: string,
    ids: number[],
  ) {
    this.result = this.run(ids);
  }

  private async run(ids: number[]) {
    if (!ids.length) return undefined;
    const products = await fetchProductsByIds(ids);
    // An older answer must not overwrite the newer check's prices, and its callers have nothing to report:
    // the newer check reports the changes to its own callers. (Only an opening sheet can be overtaken, as
    // Pay locks the cart.) Handing them the newer changes would bring back a notice already confirmed.
    if (this.next) return undefined;
    return useCartStore.getState().syncProducts(ids, products);
  }
}

let inFlight: Check | undefined;

/** The same products give the same key, whatever their order in the cart. */
const keyOf = (ids: number[]) => [...ids].sort((a, b) => a - b).join(",");

/**
 * Looks the cart's products up in the catalogue: the cart takes over their current names and prices,
 * and products that no longer exist leave it. Resolves to the changes the customer must see, if any.
 * A call made while a check of exactly the same products is in flight shares it, so the changes reach
 * every caller: Pay cannot send an order past a change that only the check of the opening sheet saw.
 * Any other cart gets a check of its own, so Pay never goes ahead on one that missed a line.
 */
export function refreshCart(): Promise<CartChanges | undefined> {
  const ids = useCartStore.getState().items.map((i) => i.productId);
  const key = keyOf(ids);
  if (inFlight?.key === key) return inFlight.result;
  const check = new Check(key, ids);
  if (inFlight) inFlight.next = check;
  inFlight = check;
  const release = () => {
    if (inFlight === check) inFlight = undefined;
  };
  void check.result.then(release, release);
  return check.result;
}
