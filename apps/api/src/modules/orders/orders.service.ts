import { createHash, randomUUID } from "node:crypto";
import {
  type CnbRates,
  type CreateOrderInput,
  type Customer,
  calcTotals,
  MAX_QUANTITY,
  type Order,
  type OrderPage,
  quotePayment,
  VAT_PERCENT,
} from "@fapi/shared";
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { orderItems, orders, products } from "../../db/schema";

export class UnknownProductError extends Error {
  constructor(public productIds: number[]) {
    super(`Unknown product(s): ${productIds.join(", ")}`);
  }
}

export class UnsupportedCurrencyError extends Error {
  constructor(public currency: string) {
    super(`No exchange rate available for ${currency}`);
  }
}

export class QuantityLimitError extends Error {
  constructor(public productIds: number[]) {
    super(`At most ${MAX_QUANTITY} pieces of one product per order: ${productIds.join(", ")}`);
  }
}

/** The idempotency key was already used by a different request. */
export class IdempotencyConflictError extends Error {
  constructor() {
    super("This idempotency key was already used for a different order");
  }
}

export interface CreateOrderResult {
  order: Order;
  /** False when the idempotency key was already used and the existing order is returned. */
  created: boolean;
}

/**
 * Prices are always taken from the DB, never from the client, and so is the exchange rate:
 * `rates` are the live ČNB rates (only needed when paying in a currency other than CZK).
 * Repeating an idempotency key with the same request returns the order it created the first time;
 * with a different request it throws IdempotencyConflictError.
 */
export function createOrder(db: Db, input: CreateOrderInput, rates?: CnbRates): CreateOrderResult {
  const existing = findOrderByKey(db, input);
  if (existing) return { order: existing, created: false };

  const quantities = mergeLines(input.items);
  const overLimit = [...quantities].filter(([, quantity]) => quantity > MAX_QUANTITY);
  if (overLimit.length) throw new QuantityLimitError(overLimit.map(([productId]) => productId));

  const rows = db
    .select()
    .from(products)
    .where(inArray(products.id, [...quantities.keys()]))
    .all();
  const missing = [...quantities.keys()].filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw new UnknownProductError(missing);

  const lines = rows.flatMap((p) => {
    const quantity = quantities.get(p.id);
    return quantity ? [{ productId: p.id, productName: p.name, unitPriceMinor: p.priceMinor, quantity }] : [];
  });
  const totals = calcTotals(lines);
  const payment = quotePayment(totals.totalMinor, input.currency, rates);
  if (!payment) throw new UnsupportedCurrencyError(input.currency);
  const id = randomUUID();

  try {
    db.transaction((tx) => {
      tx.insert(orders)
        .values({
          id,
          ...input.customer,
          vatPercent: VAT_PERCENT,
          ...totals,
          paymentCurrency: payment.currency,
          exchangeRate: payment.rate,
          exchangeRateDate: payment.rateDate,
          paymentTotalMinor: payment.totalMinor,
          idempotencyKey: input.idempotencyKey,
          requestHash: requestHash(input),
        })
        .run();
      tx.insert(orderItems)
        .values(lines.map((l) => ({ orderId: id, ...l })))
        .run();
    });
  } catch (e) {
    // A concurrent request with the same key won the race: answer with its order, or a conflict.
    const winner = isUniqueViolation(e) ? findOrderByKey(db, input) : undefined;
    if (winner) return { order: winner, created: false };
    throw e;
  }

  const order = getOrder(db, id);
  if (!order) throw new Error(`Order ${id} was not saved`);
  return { order, created: true };
}

/** Duplicate lines for the same product are merged: product id -> total quantity. */
function mergeLines(items: CreateOrderInput["items"]): Map<number, number> {
  const quantities = new Map<number, number>();
  for (const { productId, quantity } of items) {
    quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
  }
  return quantities;
}

/**
 * SHA-256 of what the request asks for: the customer as validated, the currency and the merged
 * lines sorted by product. Reordered or split lines are the same request.
 */
function requestHash({ customer, currency, items }: CreateOrderInput): string {
  // Field by field for a fixed order; a new Customer field won't compile until it is added here.
  const person: Record<keyof Customer, string> = {
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    street: customer.street,
    city: customer.city,
    zip: customer.zip,
  };
  const lines = [...mergeLines(items)].sort(([a], [b]) => a - b);
  return createHash("sha256")
    .update(JSON.stringify([person, currency, lines]))
    .digest("hex");
}

/** Drizzle wraps driver errors, keeping the original in `cause`. */
function isUniqueViolation(e: unknown): boolean {
  for (let err = e; err instanceof Error; err = err.cause) {
    if ("code" in err && err.code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  }
  return false;
}

/**
 * The order placed earlier with the input's idempotency key. A key only replays the request that
 * used it: any other request gets IdempotencyConflictError, never the order and its personal data.
 */
export function findOrderByKey(db: Db, input: CreateOrderInput): Order | undefined {
  const row = db
    .select({ id: orders.id, requestHash: orders.requestHash })
    .from(orders)
    .where(eq(orders.idempotencyKey, input.idempotencyKey))
    .get();
  if (!row) return undefined;
  // Orders saved before request_hash existed have none to compare, so their key always conflicts:
  // a retry spanning the upgrade gets 409 instead of its order, rather than risk handing it to someone else.
  if (row.requestHash !== requestHash(input)) throw new IdempotencyConflictError();
  return getOrder(db, row.id);
}

export function getOrder(db: Db, id: string): Order | undefined {
  const row = db.select().from(orders).where(eq(orders.id, id)).get();
  if (!row) return undefined;
  const items = db.select().from(orderItems).where(eq(orderItems.orderId, id)).all();
  return toOrder(row, items);
}

/** Newest first; rowid (insertion order) breaks ties between orders created in the same millisecond. */
export function listOrders(db: Db, { limit, offset }: { limit: number; offset: number }): OrderPage {
  const rows = db
    .select()
    .from(orders)
    .orderBy(desc(orders.createdAt), desc(sql`${orders}.rowid`))
    .limit(limit)
    .offset(offset)
    .all();
  const total = db.select({ value: count() }).from(orders).get()?.value ?? 0;
  if (!rows.length) return { items: [], total };

  const itemsByOrder = new Map<string, (typeof orderItems.$inferSelect)[]>();
  const pageItems = db
    .select()
    .from(orderItems)
    .where(
      inArray(
        orderItems.orderId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(orderItems.id)
    .all();
  for (const item of pageItems) {
    const group = itemsByOrder.get(item.orderId);
    if (group) group.push(item);
    else itemsByOrder.set(item.orderId, [item]);
  }

  return { items: rows.map((r) => toOrder(r, itemsByOrder.get(r.id) ?? [])), total };
}

function toOrder(row: typeof orders.$inferSelect, items: (typeof orderItems.$inferSelect)[]): Order {
  return {
    id: row.id,
    createdAt: row.createdAt,
    customer: {
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      street: row.street,
      city: row.city,
      zip: row.zip,
    },
    items: items.map((i) => ({
      productId: i.productId,
      productName: i.productName,
      unitPriceMinor: i.unitPriceMinor,
      quantity: i.quantity,
    })),
    vatPercent: row.vatPercent,
    subtotalMinor: row.subtotalMinor,
    vatMinor: row.vatMinor,
    totalMinor: row.totalMinor,
    payment: {
      currency: row.paymentCurrency,
      rate: row.exchangeRate,
      rateDate: row.exchangeRateDate,
      totalMinor: row.paymentTotalMinor,
    },
  };
}
