import { createOrderSchema, type OrderSnapshot, orderSnapshotSchema } from "@fapi/shared";
import { z } from "zod";

// The key and the order it was sent with: after a reload the snapshot fills in the checkout again,
// so the retry repeats the same request.
const attemptSchema = z.object({
  key: createOrderSchema.shape.idempotencyKey,
  snapshot: orderSnapshotSchema,
});
type Attempt = z.infer<typeof attemptSchema>;

/** Where the open attempt is kept, so a reload after a lost response retries with the same key. */
export const ATTEMPT_STORAGE_KEY = "checkout-attempt";

// In memory for the remounts (the cart sheet closed and reopened while a request is in flight) and
// mirrored to sessionStorage for reloads. The snapshot holds the shipping details, so it stays
// in this tab only and goes once the order is placed.
let attempt = restoreAttempt();

function restoreAttempt(): Attempt | undefined {
  try {
    return attemptSchema.safeParse(JSON.parse(sessionStorage.getItem(ATTEMPT_STORAGE_KEY) ?? "null")).data;
  } catch {
    // Storage is blocked or holds something that is not JSON: start without an attempt.
    return undefined;
  }
}

function saveAttempt(next: Attempt | undefined) {
  attempt = next;
  try {
    if (next) sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(ATTEMPT_STORAGE_KEY);
  } catch {
    // Storage is blocked or full: the attempt still holds in memory, just not across a reload.
  }
}

/**
 * Same customer, currency and items give the same string, whatever the order of fields and lines.
 * The expected total is left out, as the server leaves it out of its request hash: if a price changes
 * after a request whose answer was lost, the retry at the new total must get the order that request
 * may have placed, not a new key and a second order.
 */
export function fingerprintOf({ customer, currency, items }: OrderSnapshot) {
  const lines = items
    .map(({ productId, quantity }): [number, number] => [productId, quantity])
    .sort(([a], [b]) => a - b);
  return JSON.stringify([Object.entries(customer).sort(), currency, lines]);
}

/** `crypto.randomUUID` only exists on secure origins (https, localhost), not on a plain-http dev host. */
export function randomUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  // Version 4, RFC 4122 variant: the 13th digit is "4", the 17th one of 8, 9, a, b.
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/**
 * One key per checkout attempt: a retry of the same snapshot reuses it, any other snapshot gets a new one.
 * The snapshot must be read with orderSnapshotSchema first, as the server reads it.
 */
export function idempotencyKeyFor(snapshot: OrderSnapshot) {
  if (attempt && fingerprintOf(attempt.snapshot) === fingerprintOf(snapshot)) return attempt.key;
  const next = { key: randomUuid(), snapshot };
  saveAttempt(next);
  return next.key;
}

/** The order of the open attempt: sent, but not known to be placed. */
export function pendingSnapshot(): OrderSnapshot | undefined {
  return attempt?.snapshot;
}

/**
 * Whether sending `snapshot` repeats the open attempt, with its key: the server then answers with the
 * order that attempt placed, if it got through, without needing a quote.
 */
export function repeatsAttempt(snapshot: OrderSnapshot) {
  const request = orderSnapshotSchema.safeParse(snapshot);
  return Boolean(
    attempt && request.success && fingerprintOf(request.data) === fingerprintOf(attempt.snapshot),
  );
}

/** The attempt is over (the order was placed, or the server refused its key): the next one gets a fresh key. */
export function completeAttempt() {
  saveAttempt(undefined);
}
