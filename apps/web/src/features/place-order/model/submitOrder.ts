import type { CreateOrderInput, Order } from "@fapi/shared";
import { useCartStore } from "@/entities/cart";
import { ApiError } from "@/shared/api/client";
import { completeAttempt, idempotencyKeyFor, type OrderSnapshot } from "./idempotency";

/**
 * Sends the order with the cart locked while the request is in flight. On success only the
 * submitted quantities leave the cart; on failure the cart is untouched and the idempotency key is
 * kept, so retrying the same snapshot returns the order if the first request got through after all.
 * Only a 409 drops the key: the server has it for a different order, so a retry needs a new one.
 */
export async function submitOrder(
  snapshot: OrderSnapshot,
  send: (input: CreateOrderInput) => Promise<Order>,
) {
  const { setSubmitting, removeOrdered } = useCartStore.getState();
  setSubmitting(true);
  try {
    const order = await send({ ...snapshot, idempotencyKey: idempotencyKeyFor(snapshot) });
    completeAttempt();
    removeOrdered(snapshot.items);
    return order;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) completeAttempt();
    throw e;
  } finally {
    setSubmitting(false);
  }
}
