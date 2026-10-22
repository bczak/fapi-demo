import { useCartStore } from "@/entities/cart";

/** Replaces the cart with lines of `[productId, quantity]` and unlocks it. */
export const cartWith = (...lines: [productId: number, quantity: number][]) =>
  useCartStore.setState({
    items: lines.map(([productId, quantity]) => ({
      productId,
      name: `Product ${productId}`,
      priceMinor: 10_000,
      quantity,
    })),
    submitting: false,
  });

/** The cart as `[productId, quantity]` pairs. */
export const cartLines = () => useCartStore.getState().items.map((i) => [i.productId, i.quantity]);
