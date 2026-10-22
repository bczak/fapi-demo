import { PAYMENT_CURRENCIES } from "@fapi/shared";
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  priceMinor: integer("price_minor").notNull(),
  imageUrl: text("image_url"),
});

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    street: text("street").notNull(),
    city: text("city").notNull(),
    zip: text("zip").notNull(),
    vatPercent: integer("vat_percent").notNull(),
    subtotalMinor: integer("subtotal_minor").notNull(),
    vatMinor: integer("vat_minor").notNull(),
    totalMinor: integer("total_minor").notNull(),
    // What the customer pays, frozen at order time: the currency, the ČNB rate (CZK per 1 unit) and its date.
    paymentCurrency: text("payment_currency", { enum: PAYMENT_CURRENCIES }).notNull().default("CZK"),
    exchangeRate: real("exchange_rate").notNull().default(1),
    exchangeRateDate: text("exchange_rate_date"),
    paymentTotalMinor: integer("payment_total_minor").notNull().default(0),
    // Client-generated key of the checkout attempt; null for orders placed before it existed.
    idempotencyKey: text("idempotency_key"),
    // SHA-256 of the request that used the key, so the key only replays that exact request.
    // Null for orders placed before it existed.
    requestHash: text("request_hash"),
  },
  (t) => [
    uniqueIndex("orders_idempotency_key_unique").on(t.idempotencyKey),
    // The admin listing is newest first; SQLite appends the rowid, which breaks its ties.
    index("orders_created_at_idx").on(t.createdAt),
  ],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    // Snapshot of the product at purchase time, so later price changes don't rewrite history.
    productName: text("product_name").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [index("order_items_order_id_idx").on(t.orderId)],
);
