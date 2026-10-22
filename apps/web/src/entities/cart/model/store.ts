import { calcTotals, MAX_QUANTITY, type Product } from "@fapi/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartItem {
  productId: number;
  name: string;
  /** Net unit price in haléře. Informational only - the server recomputes prices. */
  priceMinor: number;
  quantity: number;
}

/** A cart line as it was sent to the server. */
export type OrderedLine = Pick<CartItem, "productId" | "quantity">;

/** A line whose net unit price is no longer the one it was put in the cart with. */
export interface PriceChange {
  productId: number;
  name: string;
  oldPriceMinor: number;
  newPriceMinor: number;
}

/** What a check against the catalogue changed in the cart, for the customer to see. */
export interface CartChanges {
  repriced: PriceChange[];
  /** Lines taken out because their product no longer exists. */
  removed: CartItem[];
}

interface CartState {
  items: CartItem[];
  /** True while a checkout request is in flight. Editing controls are disabled meanwhile. Not persisted. */
  submitting: boolean;
  add: (product: Product) => void;
  setQuantity: (productId: number, quantity: number) => void;
  remove: (productId: number) => void;
  setSubmitting: (submitting: boolean) => void;
  /** Takes the submitted quantities out of the cart and keeps whatever else is in it. */
  removeOrdered: (ordered: OrderedLine[]) => void;
  /**
   * Takes over the current names and prices from `products`, the catalogue's answer for `checked`.
   * A checked line without its product no longer exists and leaves the cart; lines added since the
   * check started are kept as they are. Returns the price changes and removals, or undefined when
   * there are none (a new name alone does not change what the customer pays).
   */
  syncProducts: (checked: readonly number[], products: readonly Product[]) => CartChanges | undefined;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      submitting: false,
      add: (product) =>
        set(({ items }) => {
          const existing = items.find((i) => i.productId === product.id);
          if (existing) {
            return {
              items: items.map((i) =>
                i.productId === product.id ? { ...i, quantity: Math.min(i.quantity + 1, MAX_QUANTITY) } : i,
              ),
            };
          }
          return {
            items: [
              ...items,
              { productId: product.id, name: product.name, priceMinor: product.priceMinor, quantity: 1 },
            ],
          };
        }),
      setQuantity: (productId, quantity) =>
        set(({ items }) => ({
          items: items.map((i) =>
            i.productId === productId ? { ...i, quantity: Math.min(Math.max(quantity, 1), MAX_QUANTITY) } : i,
          ),
        })),
      remove: (productId) => set(({ items }) => ({ items: items.filter((i) => i.productId !== productId) })),
      setSubmitting: (submitting) => set({ submitting }),
      removeOrdered: (ordered) =>
        set(({ items }) => ({
          items: items.flatMap((item) => {
            const sent = ordered.find((o) => o.productId === item.productId)?.quantity ?? 0;
            const left = item.quantity - sent;
            return left > 0 ? [{ ...item, quantity: left }] : [];
          }),
        })),
      syncProducts: (checked, products) => {
        const checkedIds = new Set(checked);
        const current = new Map(products.map((p) => [p.id, p]));
        const repriced: PriceChange[] = [];
        const removed: CartItem[] = [];
        const { items } = get();
        const synced = items.flatMap((item) => {
          if (!checkedIds.has(item.productId)) return [item];
          const product = current.get(item.productId);
          if (!product) {
            removed.push(item);
            return [];
          }
          if (product.priceMinor !== item.priceMinor) {
            repriced.push({
              productId: item.productId,
              name: product.name,
              oldPriceMinor: item.priceMinor,
              newPriceMinor: product.priceMinor,
            });
          }
          const same = product.name === item.name && product.priceMinor === item.priceMinor;
          return [same ? item : { ...item, name: product.name, priceMinor: product.priceMinor }];
        });
        // Unchanged lines keep their identity, so a check that finds nothing leaves the cart alone.
        if (synced.length !== items.length || synced.some((item, i) => item !== items[i])) {
          set({ items: synced });
        }
        return repriced.length || removed.length ? { repriced, removed } : undefined;
      },
    }),
    { name: "cart", partialize: ({ items }) => ({ items }) },
  ),
);

export const useCartCount = () => useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));

/** True while an order is being placed; the cart must not change until the request is settled. */
export const useCartSubmitting = () => useCartStore((s) => s.submitting);

export function useCartTotals() {
  const items = useCartStore((s) => s.items);
  return calcTotals(items.map((i) => ({ unitPriceMinor: i.priceMinor, quantity: i.quantity })));
}
