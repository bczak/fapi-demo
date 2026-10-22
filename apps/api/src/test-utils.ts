import { randomUUID } from "node:crypto";
import { type CnbRates, calcTotals } from "@fapi/shared";
import { createApp } from "./app";
import { createDb } from "./db/client";
import { products } from "./db/schema";
import { seedProducts } from "./db/seed";

export const SAMPLE_RATES: CnbRates = {
  date: "2026-10-21",
  rates: [
    { country: "EMU", currency: "euro", code: "EUR", amount: 1, rate: 25 },
    { country: "USA", currency: "dolar", code: "USD", amount: 1, rate: 21.593 },
  ],
};

export const ADMIN = { user: "admin", password: "password" };

export const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

export function setup(getRates: () => Promise<CnbRates> = async () => SAMPLE_RATES) {
  const db = createDb(":memory:");
  seedProducts(db);
  return { db, app: createApp({ db, getRates, admin: ADMIN }) };
}

export const validCustomer = {
  firstName: "Jan",
  lastName: "Novák",
  email: "jan@example.com",
  phone: "+420 123 456 789",
  street: "Hlavní 1",
  city: "Praha",
  zip: "110 00",
};

export const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Net unit prices of the seeded catalogue, as `setup` stocks it. */
const seededPrices = (() => {
  const db = createDb(":memory:");
  seedProducts(db);
  const prices = new Map(
    db
      .select()
      .from(products)
      .all()
      .map((p) => [p.id, p.priceMinor]),
  );
  db.$client.close();
  return prices;
})();

/** The total incl. VAT of `items` at the seeded prices: what the checkout shows the customer. */
export const seededTotalOf = (items: readonly { productId: number; quantity: number }[]) =>
  calcTotals(items.map((i) => ({ unitPriceMinor: seededPrices.get(i.productId) ?? 0, quantity: i.quantity })))
    .totalMinor;

/**
 * A valid POST /api/orders body, for one piece of product 1 unless `overrides` say otherwise. Every call
 * gets a fresh idempotency key, and the total of its items is the one confirmed, as the web app sends it.
 */
export const orderBody = (overrides: object = {}) => {
  const body = {
    customer: validCustomer,
    items: [{ productId: 1, quantity: 1 }],
    idempotencyKey: randomUUID(),
    ...overrides,
  };
  return { expectedTotalMinor: seededTotalOf(body.items), ...body };
};

export const getAdminOrders = (app: ReturnType<typeof setup>["app"], query = "") =>
  app.request(`/api/admin/orders${query}`, { headers: { Authorization: basic(ADMIN.user, ADMIN.password) } });
