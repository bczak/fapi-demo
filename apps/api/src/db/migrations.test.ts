import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createOrder,
  getOrder,
  IdempotencyConflictError,
  listOrders,
} from "../modules/orders/orders.service";
import { validCustomer } from "../test-utils";
import { createDb, migrationsFolder } from "./client";
import { orders } from "./schema";

const journalSchema = z.looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) });

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fapi-migrations-"));
  dbPath = join(dir, "shop.db");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A database file with only the first `count` migrations applied, as an older release left it. */
function databaseAt(count: number) {
  const folder = join(dir, "migrations");
  mkdirSync(join(folder, "meta"), { recursive: true });
  const journal = journalSchema.parse(
    JSON.parse(readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8")),
  );
  const entries = journal.entries.slice(0, count);
  for (const { tag } of entries)
    copyFileSync(join(migrationsFolder, `${tag}.sql`), join(folder, `${tag}.sql`));
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));

  const sqlite = new Database(dbPath);
  migrate(drizzle(sqlite), { migrationsFolder: folder });
  return sqlite;
}

/** Raw SQL, as the release that owned the database wrote its rows. */
function insert(sqlite: Database.Database, table: string, row: Record<string, string | number>) {
  const columns = Object.keys(row);
  sqlite
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...Object.values(row));
}

const PRODUCT = { id: 1, name: "Wireless Mouse", description: "Ergonomic", price_minor: 89_900 };

const LEGACY_ORDER = {
  id: "0b9c3f1e-6a2d-4f8b-9c1e-2d3f4a5b6c7d",
  created_at: "2026-01-15T09:30:00.000Z",
  first_name: validCustomer.firstName,
  last_name: validCustomer.lastName,
  email: validCustomer.email,
  phone: validCustomer.phone,
  street: validCustomer.street,
  city: validCustomer.city,
  zip: validCustomer.zip,
  vat_percent: 21,
  subtotal_minor: 179_800,
  vat_minor: 37_758,
  total_minor: 217_558,
};

const LEGACY_ITEM = {
  order_id: LEGACY_ORDER.id,
  product_id: PRODUCT.id,
  product_name: PRODUCT.name,
  unit_price_minor: PRODUCT.price_minor,
  quantity: 2,
};

const CZK_PAYMENT = {
  payment_currency: "CZK",
  exchange_rate: 1,
  payment_total_minor: LEGACY_ORDER.total_minor,
};

const newOrder = (idempotencyKey = randomUUID()) => ({
  customer: validCustomer,
  currency: "CZK" as const,
  idempotencyKey,
  items: [{ productId: PRODUCT.id, quantity: 2 }],
});

describe("migrating an existing database", () => {
  it.each([
    ["0000..0001, before payment currencies", 2, {}],
    ["0000..0002, before idempotency keys", 3, CZK_PAYMENT],
  ])("keeps the orders of a database migrated %s, and takes new ones", (_, count, payment) => {
    const legacy = databaseAt(count);
    insert(legacy, "products", PRODUCT);
    insert(legacy, "orders", { ...LEGACY_ORDER, ...payment });
    insert(legacy, "order_items", LEGACY_ITEM);
    legacy.close();

    const db = createDb(dbPath);
    expect(getOrder(db, LEGACY_ORDER.id)).toEqual({
      id: LEGACY_ORDER.id,
      createdAt: LEGACY_ORDER.created_at,
      customer: validCustomer,
      items: [{ productId: 1, productName: "Wireless Mouse", unitPriceMinor: 89_900, quantity: 2 }],
      vatPercent: 21,
      subtotalMinor: 179_800,
      vatMinor: 37_758,
      totalMinor: 217_558,
      // Orders from before payment currencies were all paid in CZK.
      payment: { currency: "CZK", rate: 1, rateDate: null, totalMinor: 217_558 },
    });
    expect(db.select({ key: orders.idempotencyKey, hash: orders.requestHash }).from(orders).all()).toEqual([
      { key: null, hash: null },
    ]);

    const { order, created } = createOrder(db, newOrder());
    expect(created).toBe(true);
    const page = listOrders(db, { limit: 20, offset: 0 });
    expect(page.items.map((o) => o.id)).toEqual([order.id, LEGACY_ORDER.id]);
    expect(page.total).toBe(2);
    db.$client.close();
  });

  it("answers a key saved before request fingerprints with a conflict, even for the same request", () => {
    const key = randomUUID();
    const legacy = databaseAt(4);
    insert(legacy, "products", PRODUCT);
    insert(legacy, "orders", { ...LEGACY_ORDER, ...CZK_PAYMENT, idempotency_key: key });
    insert(legacy, "order_items", LEGACY_ITEM);
    legacy.close();

    const db = createDb(dbPath);
    expect(() => createOrder(db, newOrder(key))).toThrow(IdempotencyConflictError);
    expect(listOrders(db, { limit: 20, offset: 0 }).total).toBe(1);
    db.$client.close();
  });
});

describe("migrated schema", () => {
  it("lists orders newest first straight from the created_at index, without sorting", () => {
    const db = createDb(":memory:");
    // The ORDER BY of listOrders (the admin listing).
    const plan = db.$client
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM orders ORDER BY created_at DESC, rowid DESC LIMIT 20 OFFSET 40",
      )
      .all();
    expect(plan).toEqual([
      expect.objectContaining({ detail: "SCAN orders USING INDEX orders_created_at_idx" }),
    ]);
  });
});
