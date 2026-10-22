import { type CreateOrderInput, type Order, type OrderSnapshot, orderSnapshotSchema } from "@fapi/shared";
import { type CartChanges, useCartStore } from "@/entities/cart";
import { ApiError } from "@/shared/api/client";
import { completeAttempt, idempotencyKeyFor, repeatsAttempt } from "./idempotency";
import { refreshCart } from "./refreshCart";

/** The order as the customer confirmed it, with the CZK total they saw, for the server to hold it to. */
export type ConfirmedOrder = OrderSnapshot & { expectedTotalMinor: number };

/** The order was placed, or the cart changed and nothing was sent. */
export type SubmitResult = { order: Order } | { changes: CartChanges };

const isPriceChange = (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === "price_changed";

/**
 * Checks the cart against the catalogue (unless this repeats the attempt sent without an answer), then
 * sends the order, with the cart locked throughout.
 * If a price changed or a product is gone nothing is sent: the cart now holds the current prices and
 * the changes come back, for the customer to confirm the new total by paying again. The same happens
 * when the server refuses the total because a price changed after the check (409 price_changed).
 * The snapshot is read as the API reads it (trimmed) before it is fingerprinted and sent, so a retry
 * the server takes for the same order gets the same key.
 * On success only the submitted quantities leave the cart; on failure the cart is untouched and the
 * idempotency key is kept, so retrying the same snapshot returns the order if the first request got
 * through after all. Only an idempotency conflict (any other 409) drops the key: the server has it for
 * a different order, so a retry needs a new one.
 */
export async function submitOrder(
  snapshot: ConfirmedOrder,
  send: (input: CreateOrderInput) => Promise<Order>,
): Promise<SubmitResult> {
  const { setSubmitting, removeOrdered } = useCartStore.getState();
  setSubmitting(true);
  try {
    const request = orderSnapshotSchema.parse(snapshot);
    // A retry of the order sent without an answer goes straight to the server, which returns that order
    // if it got through, so a catalogue that is down cannot block it; were it not placed and a price
    // changed, the server refuses the confirmed total (409 price_changed) and the check runs below.
    if (!repeatsAttempt(request)) {
      const changes = await refreshCart();
      if (changes) return { changes };
    }
    const order = await send({ ...request, idempotencyKey: idempotencyKeyFor(request) });
    completeAttempt();
    removeOrdered(request.items);
    return { order };
  } catch (e) {
    if (isPriceChange(e)) {
      // Nothing was placed and the key stays free for the order at the new total. Without a change to
      // show (the check failed or found none), the server's message says what happened.
      const changes = await refreshCart().catch(() => undefined);
      if (changes) return { changes };
    } else if (e instanceof ApiError && e.status === 409) {
      completeAttempt();
    }
    throw e;
  } finally {
    setSubmitting(false);
  }
}
