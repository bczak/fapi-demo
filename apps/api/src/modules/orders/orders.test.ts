import { randomUUID } from "node:crypto";
import {
  type CreateOrderInput,
  calcTotals,
  type Order,
  type OrderPage,
  type Product,
  type ProductPage,
} from "@fapi/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import type { Db } from "../../db/client";
import { orders, products } from "../../db/schema";
import {
  ADMIN,
  basic,
  getAdminOrders,
  orderBody,
  postJson,
  SAMPLE_RATES,
  seededTotalOf,
  setup,
  validCustomer,
} from "../../test-utils";
import { createOrder, PriceChangedError, QuantityLimitError } from "./orders.service";

type App = ReturnType<typeof setup>["app"];

const placeOrder = async (app: App, overrides: object = {}) => {
  const res = await app.request("/api/orders", postJson(orderBody(overrides)));
  expect(res.status).toBe(201);
  return (await res.json()) as Order;
};

const setCreatedAt = (db: Db, id: string, createdAt: string) =>
  db.update(orders).set({ createdAt }).where(eq(orders.id, id)).run();

const countOrders = (db: Db) => db.select().from(orders).all().length;

const otherCustomer = {
  ...validCustomer,
  firstName: "Eva",
  lastName: "Svobodová",
  email: "eva@example.com",
  phone: "+420 987 654 321",
};

/** A reused key is answered with a message only, never with the order behind it. */
const expectConflict = async (res: Response) => {
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    message: "This idempotency key was already used for a different order",
    code: "idempotency_conflict",
  });
};

/** The shop changes the net price of product `id` to `priceMinor`. */
const setPrice = (db: Db, id: number, priceMinor: number) =>
  db.update(products).set({ priceMinor }).where(eq(products.id, id)).run();

const priceOf = (db: Db, id: number) =>
  db.select({ priceMinor: products.priceMinor }).from(products).where(eq(products.id, id)).get()
    ?.priceMinor ?? 0;

/** `db`, on which `rival` commits, like a concurrent request, between our key lookup and our insert. */
const racingDb = (db: Db, rival: () => void) =>
  new Proxy(db, {
    get(target, prop) {
      if (prop === "transaction") {
        return (...args: Parameters<Db["transaction"]>) => {
          rival();
          return target.transaction(...args);
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

describe("POST /api/orders", () => {
  it("stores the order, computing prices and 21% VAT on the server", async () => {
    const { app } = setup();
    const { items } = (await (await app.request("/api/products")).json()) as ProductPage;
    const [a, b] = items as [Product, Product];

    const res = await app.request(
      "/api/orders",
      postJson(
        orderBody({
          // Client-sent prices must be ignored.
          items: [
            { productId: a.id, quantity: 2, unitPriceMinor: 1 },
            { productId: b.id, quantity: 1 },
          ],
        }),
      ),
    );
    expect(res.status).toBe(201);
    const order = (await res.json()) as Order;

    const subtotal = a.priceMinor * 2 + b.priceMinor;
    expect(order.subtotalMinor).toBe(subtotal);
    expect(order.vatPercent).toBe(21);
    expect(order.vatMinor).toBe(Math.round(subtotal * 0.21));
    expect(order.totalMinor).toBe(order.subtotalMinor + order.vatMinor);
    expect(order.items).toHaveLength(2);

    // It is retrievable by id (thank-you page).
    const fetched = await app.request(`/api/orders/${order.id}`);
    expect(fetched.status).toBe(200);
    expect(((await fetched.json()) as Order).customer.email).toBe("jan@example.com");
  });

  it("merges duplicate product lines", async () => {
    const { app } = setup();
    const order = await placeOrder(app, {
      items: [
        { productId: 1, quantity: 1 },
        { productId: 1, quantity: 2 },
      ],
    });
    expect(order.items).toEqual([expect.objectContaining({ productId: 1, quantity: 3 })]);
  });

  it("rejects invalid customer data with field-level issues", async () => {
    const { app } = setup();
    const res = await app.request(
      "/api/orders",
      postJson(orderBody({ customer: { ...validCustomer, email: "nope", phone: "1" } })),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(["customer.email", "customer.phone"]),
    );
  });

  it("rejects a phone number padded with spaces beyond 20 characters", async () => {
    const { app, db } = setup();
    const phone = `+420${" ".repeat(30)}123456789`;
    const res = await app.request(
      "/api/orders",
      postJson(orderBody({ customer: { ...validCustomer, phone } })),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path)).toContain("customer.phone");
    expect(countOrders(db)).toBe(0);
  });

  it("rejects an empty cart and unknown products", async () => {
    const { app } = setup();
    const empty = await app.request("/api/orders", postJson(orderBody({ items: [] })));
    expect(empty.status).toBe(422);

    const unknown = await app.request(
      "/api/orders",
      postJson(orderBody({ items: [{ productId: 9999, quantity: 1 }] })),
    );
    expect(unknown.status).toBe(422);
  });

  it("rejects a missing or malformed idempotency key", async () => {
    const { app } = setup();
    const { idempotencyKey: _omitted, ...withoutKey } = orderBody();
    const missing = await app.request("/api/orders", postJson(withoutKey));
    expect(missing.status).toBe(422);

    const malformed = await app.request("/api/orders", postJson(orderBody({ idempotencyKey: "abc" })));
    expect(malformed.status).toBe(422);
    const body = (await malformed.json()) as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path)).toContain("idempotencyKey");

    // The nil UUID is a key any client could send: only random (v4) keys are accepted.
    const nil = await app.request(
      "/api/orders",
      postJson(orderBody({ idempotencyKey: "00000000-0000-0000-0000-000000000000" })),
    );
    expect(nil.status).toBe(422);
  });

  it("returns 404 for a missing order", async () => {
    const { app } = setup();
    const res = await app.request("/api/orders/3f6c8a52-5b0e-4c43-9a43-1f2b6d3a9c11");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/orders - quantity limit", () => {
  it("accepts duplicate lines whose sum stays within 99", async () => {
    const { app } = setup();
    const order = await placeOrder(app, {
      items: [
        { productId: 1, quantity: 98 },
        { productId: 1, quantity: 1 },
      ],
    });
    expect(order.items).toEqual([expect.objectContaining({ productId: 1, quantity: 99 })]);
  });

  it("rejects duplicate lines of one product that sum above 99, and stores nothing", async () => {
    const { app, db } = setup();
    const res = await app.request(
      "/api/orders",
      postJson(
        orderBody({
          items: [
            { productId: 1, quantity: 99 },
            { productId: 2, quantity: 1 },
            { productId: 1, quantity: 99 },
          ],
        }),
      ),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { path: string; message: string }[] };
    expect(body.issues).toEqual([
      { path: "items.2.quantity", message: "You can order at most 99 pieces of one product" },
    ]);
    expect(countOrders(db)).toBe(0);
  });

  it("is enforced by the service too, for callers that skip the schema", () => {
    const { db } = setup();
    const input: CreateOrderInput = {
      customer: validCustomer,
      currency: "CZK",
      idempotencyKey: randomUUID(),
      items: [
        { productId: 1, quantity: 99 },
        { productId: 1, quantity: 99 },
      ],
    };
    expect(() => createOrder(db, input)).toThrow(QuantityLimitError);
    expect(countOrders(db)).toBe(0);
  });
});

describe("POST /api/orders - idempotency", () => {
  it("returns the existing order with 200 when a key is repeated", async () => {
    const { app, db } = setup();
    const body = orderBody();

    const first = await app.request("/api/orders", postJson(body));
    const second = await app.request("/api/orders", postJson(body));

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const firstOrder = (await first.json()) as Order;
    expect(await second.json()).toEqual(firstOrder);
    expect(countOrders(db)).toBe(1);
  });

  it("creates separate orders for different keys", async () => {
    const { app, db } = setup();
    const a = await placeOrder(app);
    const b = await placeOrder(app);
    expect(a.id).not.toBe(b.id);
    expect(countOrders(db)).toBe(2);
  });

  it("creates one order when identical requests arrive concurrently", async () => {
    const { app, db } = setup();
    const request = postJson(orderBody({ currency: "EUR" }));

    const responses = await Promise.all(Array.from({ length: 3 }, () => app.request("/api/orders", request)));

    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    const ids = await Promise.all(responses.map(async (r) => ((await r.json()) as Order).id));
    expect(new Set(ids).size).toBe(1);
    expect(countOrders(db)).toBe(1);
  });

  it("answers with the winner when the insert loses the race on the unique key", () => {
    const { db } = setup();
    const input: CreateOrderInput = {
      customer: validCustomer,
      currency: "CZK",
      idempotencyKey: randomUUID(),
      items: [{ productId: 1, quantity: 1 }],
    };

    const result = createOrder(
      racingDb(db, () => createOrder(db, input)),
      input,
    );

    expect(result.created).toBe(false);
    expect(countOrders(db)).toBe(1);
    expect(result.order.id).toBe(db.select().from(orders).get()?.id);
  });

  it("answers 409 without the winner's order when the race on the key was won by another request", async () => {
    const { db } = setup();
    const body = orderBody();
    const rival: CreateOrderInput = { ...body, customer: otherCustomer, currency: "CZK" };
    const app = createApp({
      db: racingDb(db, () => createOrder(db, rival)),
      getRates: async () => SAMPLE_RATES,
      admin: ADMIN,
    });

    await expectConflict(await app.request("/api/orders", postJson(body)));
    expect(countOrders(db)).toBe(1);
    expect(db.select().from(orders).get()?.email).toBe(otherCustomer.email);
  });

  it.each([
    ["another customer", { customer: otherCustomer }],
    ["another product", { items: [{ productId: 2, quantity: 1 }] }],
    ["another quantity", { items: [{ productId: 1, quantity: 2 }] }],
    ["another currency", { currency: "EUR" }],
  ])("answers a key reused for %s with 409, not the first order", async (_, change) => {
    const { app, db } = setup();
    const body = orderBody();
    expect((await app.request("/api/orders", postJson(body))).status).toBe(201);

    await expectConflict(await app.request("/api/orders", postJson({ ...body, ...change })));
    expect(countOrders(db)).toBe(1);
  });

  it("replays a key for the same request, whatever the line order, split lines or padding", async () => {
    const { app, db } = setup();
    const body = orderBody({
      items: [
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 1 },
      ],
    });
    const first = (await (await app.request("/api/orders", postJson(body))).json()) as Order;

    const retry = await app.request(
      "/api/orders",
      postJson({
        ...body,
        customer: { ...validCustomer, firstName: `  ${validCustomer.firstName} ` },
        items: [
          { productId: 2, quantity: 1 },
          { productId: 1, quantity: 1 },
          { productId: 1, quantity: 1 },
        ],
      }),
    );

    expect(retry.status).toBe(200);
    expect(((await retry.json()) as Order).id).toBe(first.id);
    expect(countOrders(db)).toBe(1);
  });

  it("treats the key in upper case as the same key", async () => {
    const { app, db } = setup();
    const body = orderBody();
    const first = (await (await app.request("/api/orders", postJson(body))).json()) as Order;

    const retry = await app.request(
      "/api/orders",
      postJson({ ...body, idempotencyKey: body.idempotencyKey.toUpperCase() }),
    );

    expect(retry.status).toBe(200);
    expect(((await retry.json()) as Order).id).toBe(first.id);
    expect(countOrders(db)).toBe(1);
  });

  it("checks a reused key before fetching exchange rates", async () => {
    const getRates = vi.fn(async () => {
      throw new Error("down");
    });
    const { app } = setup(getRates);
    const body = orderBody();
    expect((await app.request("/api/orders", postJson(body))).status).toBe(201);

    await expectConflict(
      await app.request("/api/orders", postJson({ ...body, customer: otherCustomer, currency: "EUR" })),
    );
    expect(getRates).not.toHaveBeenCalled();
  });

  it("answers 409 to the loser when concurrent requests share a key but not the payload", async () => {
    const { app, db } = setup();
    const body = orderBody({ currency: "EUR" });

    const responses = await Promise.all([
      app.request("/api/orders", postJson(body)),
      app.request("/api/orders", postJson({ ...body, customer: otherCustomer })),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(countOrders(db)).toBe(1);
  });

  it("answers 409 for a key whose order predates request fingerprints, even to the same request", async () => {
    const { app, db } = setup();
    const body = orderBody();
    const first = (await (await app.request("/api/orders", postJson(body))).json()) as Order;
    db.update(orders).set({ requestHash: null }).where(eq(orders.id, first.id)).run();

    await expectConflict(await app.request("/api/orders", postJson(body)));
  });

  it("returns the existing order on retry even when exchange rates are down", async () => {
    let ratesUp = true;
    const { app } = setup(async () => {
      if (!ratesUp) throw new Error("down");
      return SAMPLE_RATES;
    });
    const request = postJson(orderBody({ currency: "EUR" }));
    const first = await app.request("/api/orders", request);
    ratesUp = false;
    const retry = await app.request("/api/orders", request);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as Order).id).toBe(((await first.json()) as Order).id);
  });
});

describe("POST /api/orders - the total the customer confirmed", () => {
  const PRICE_CHANGED = {
    message: "Prices have changed since you confirmed the order. Check the new total and pay again.",
    code: "price_changed",
  };

  it("places the order at the total the customer confirmed", async () => {
    const { app } = setup();
    const body = orderBody({ items: [{ productId: 2, quantity: 3 }] });
    const order = await placeOrder(app, body);
    expect(order.totalMinor).toBe(body.expectedTotalMinor);
  });

  it("answers 409 price_changed and saves nothing when a price changed after the customer confirmed", async () => {
    const { app, db } = setup();
    const body = orderBody();
    setPrice(db, 1, priceOf(db, 1) + 100);

    const res = await app.request("/api/orders", postJson(body));

    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(PRICE_CHANGED);
    expect(countOrders(db)).toBe(0);
  });

  it("keeps the key free: the order at the new total goes through with it", async () => {
    const { app, db } = setup();
    const body = orderBody();
    setPrice(db, 1, priceOf(db, 1) + 100);
    expect((await app.request("/api/orders", postJson(body))).status).toBe(409);

    const newTotal = calcTotals([{ unitPriceMinor: priceOf(db, 1), quantity: 1 }]).totalMinor;
    const res = await app.request("/api/orders", postJson({ ...body, expectedTotalMinor: newTotal }));

    expect(res.status).toBe(201);
    expect(((await res.json()) as Order).totalMinor).toBe(newTotal);
  });

  it("returns a placed order to its retry after a price change, whatever total the retry expects", async () => {
    const { app, db } = setup();
    const body = orderBody();
    const first = await placeOrder(app, body);
    setPrice(db, 1, priceOf(db, 1) + 100);
    const newTotal = calcTotals([{ unitPriceMinor: priceOf(db, 1), quantity: 1 }]).totalMinor;

    for (const expectedTotalMinor of [body.expectedTotalMinor, newTotal]) {
      const retry = await app.request("/api/orders", postJson({ ...body, expectedTotalMinor }));
      expect(retry.status).toBe(200);
      expect(((await retry.json()) as Order).id).toBe(first.id);
    }
    expect(countOrders(db)).toBe(1);
  });

  it("is the total in CZK, also for an order paid in EUR", async () => {
    const { app } = setup();
    const expectedTotalMinor = seededTotalOf([{ productId: 1, quantity: 1 }]);
    const order = await placeOrder(app, { currency: "EUR", expectedTotalMinor });
    expect(order.totalMinor).toBe(expectedTotalMinor);
    expect(order.payment.totalMinor).not.toBe(expectedTotalMinor);
  });

  it("still places an order sent without it, as a page loaded before the check sends it", async () => {
    const { app } = setup();
    const { expectedTotalMinor: _omitted, ...unchecked } = orderBody();
    expect((await app.request("/api/orders", postJson(unchecked))).status).toBe(201);
  });

  it("rejects a total that is not a whole number of haléře", async () => {
    const { app, db } = setup();
    for (const expectedTotalMinor of [-1, 30_250.5, "30250"]) {
      const res = await app.request("/api/orders", postJson(orderBody({ expectedTotalMinor })));
      expect(res.status).toBe(422);
      const body = (await res.json()) as { issues: { path: string }[] };
      expect(body.issues.map((i) => i.path)).toEqual(["expectedTotalMinor"]);
    }
    expect(countOrders(db)).toBe(0);
  });

  it("lets the service return a placed order to its retry before comparing totals", () => {
    const { db } = setup();
    const body = orderBody();
    const input = { ...body, currency: "CZK" as const };
    expect(createOrder(db, input).created).toBe(true);
    setPrice(db, 1, priceOf(db, 1) + 100);

    const retry = createOrder(db, input);

    expect(retry.created).toBe(false);
    expect(countOrders(db)).toBe(1);
  });

  it("is checked by the service too, for callers that skip the route", () => {
    const { db } = setup();
    const body = orderBody();
    const input = { ...body, currency: "CZK" as const, expectedTotalMinor: body.expectedTotalMinor - 1 };
    expect(() => createOrder(db, input)).toThrow(PriceChangedError);
    expect(countOrders(db)).toBe(0);
  });
});

describe("POST /api/orders - payment currency", () => {
  const order1 = (extra: object = {}) => postJson(orderBody(extra));

  it("defaults to CZK without conversion", async () => {
    const { app } = setup();
    const order = (await (await app.request("/api/orders", order1())).json()) as Order;
    expect(order.payment).toEqual({
      currency: "CZK",
      rate: 1,
      rateDate: null,
      totalMinor: order.totalMinor,
    });
  });

  it("converts with the live ČNB rate on the server and stores rate and date", async () => {
    const { app } = setup();
    const res = await app.request("/api/orders", order1({ currency: "EUR" }));
    expect(res.status).toBe(201);
    const order = (await res.json()) as Order;
    expect(order.payment).toEqual({
      currency: "EUR",
      rate: 25,
      rateDate: SAMPLE_RATES.date,
      totalMinor: Math.round(order.totalMinor / 25),
    });

    // Saved with the order: the thank-you page and the admin read it back.
    const fetched = (await (await app.request(`/api/orders/${order.id}`)).json()) as Order;
    expect(fetched.payment).toEqual(order.payment);
    const { items } = (await (await getAdminOrders(app)).json()) as OrderPage;
    expect(items[0]?.payment).toEqual(order.payment);
  });

  it("ignores an amount sent by the client", async () => {
    const { app } = setup();
    const res = await app.request(
      "/api/orders",
      order1({ currency: "USD", payment: { totalMinor: 1, rate: 1 } }),
    );
    const order = (await res.json()) as Order;
    expect(order.payment.rate).toBe(21.593);
    expect(order.payment.totalMinor).toBe(Math.round((order.totalMinor / 100 / 21.593) * 100));
  });

  it("answers 502 and saves nothing when rates are unavailable, but CZK still works", async () => {
    const { app } = setup(async () => {
      throw new Error("down");
    });
    const eur = await app.request("/api/orders", order1({ currency: "EUR" }));
    expect(eur.status).toBe(502);
    expect((await app.request("/api/orders", order1())).status).toBe(201);

    const { total } = (await (await getAdminOrders(app)).json()) as OrderPage;
    expect(total).toBe(1);
  });

  it("rejects currencies that can't be paid in", async () => {
    const { app } = setup();
    const res = await app.request("/api/orders", order1({ currency: "GBP" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: { path: string }[] };
    expect(body.issues.map((i) => i.path)).toContain("currency");
  });
});

describe("POST /api/orders - caching", () => {
  it("is never cached, whatever the outcome, as answers hold personal data", async () => {
    const { app } = setup();
    const body = orderBody();
    const responses = [
      await app.request("/api/orders", postJson(body)),
      await app.request("/api/orders", postJson(body)),
      await app.request("/api/orders", postJson({ ...body, customer: otherCustomer })),
      await app.request("/api/orders", postJson(orderBody({ items: [] }))),
      await app.request("/api/orders", postJson(orderBody({ items: [{ productId: 9999, quantity: 1 }] }))),
    ];

    expect(responses.map((r) => [r.status, r.headers.get("Cache-Control")])).toEqual([
      [201, "no-store"],
      [200, "no-store"],
      [409, "no-store"],
      [422, "no-store"],
      [422, "no-store"],
    ]);
  });
});

describe("GET /api/orders/:id", () => {
  it("is never cached, as it holds personal data", async () => {
    const { app } = setup();
    const order = await placeOrder(app);

    const found = await app.request(`/api/orders/${order.id}`);
    expect(found.status).toBe(200);
    expect(found.headers.get("Cache-Control")).toBe("no-store");

    const missing = await app.request(`/api/orders/${randomUUID()}`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns what the thank-you page needs", async () => {
    const { app } = setup();
    const order = await placeOrder(app, { items: [{ productId: 1, quantity: 2 }] });

    const fetched = (await (await app.request(`/api/orders/${order.id}`)).json()) as Order;
    expect(fetched).toEqual({
      id: order.id,
      createdAt: expect.any(String),
      customer: validCustomer,
      items: [expect.objectContaining({ productId: 1, quantity: 2 })],
      vatPercent: 21,
      subtotalMinor: expect.any(Number),
      vatMinor: expect.any(Number),
      totalMinor: expect.any(Number),
      payment: expect.objectContaining({ currency: "CZK" }),
    });
  });
});

describe("GET /api/admin/orders", () => {
  it("requires valid credentials", async () => {
    const { app } = setup();
    expect((await app.request("/api/admin/orders")).status).toBe(401);
    const bad = await app.request("/api/admin/orders", {
      headers: { Authorization: basic("admin", "wrong") },
    });
    expect(bad.status).toBe(401);
    // No WWW-Authenticate header, so browsers don't show their native dialog.
    expect(bad.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("lists orders newest first by creation time, not insertion order", async () => {
    const { app, db } = setup();
    const a = await placeOrder(app);
    const b = await placeOrder(app);
    const c = await placeOrder(app);
    setCreatedAt(db, a.id, "2026-03-02T10:00:00.000Z");
    setCreatedAt(db, b.id, "2026-03-03T10:00:00.000Z");
    setCreatedAt(db, c.id, "2026-03-01T10:00:00.000Z");

    const res = await getAdminOrders(app);
    expect(res.status).toBe(200);
    const page = (await res.json()) as OrderPage;
    expect(page.items.map((o) => o.id)).toEqual([b.id, a.id, c.id]);
    expect(page.total).toBe(3);
  });

  it("orders ties on the creation time deterministically, latest insert first", async () => {
    const { app, db } = setup();
    const first = await placeOrder(app);
    const second = await placeOrder(app);
    const third = await placeOrder(app);
    for (const o of [first, second, third]) setCreatedAt(db, o.id, "2026-03-01T10:00:00.000Z");

    const { items } = (await (await getAdminOrders(app)).json()) as OrderPage;
    expect(items.map((o) => o.id)).toEqual([third.id, second.id, first.id]);
  });

  it("paginates with limit and offset and reports the total", async () => {
    const { app, db } = setup();
    const placed: Order[] = [];
    for (const day of [1, 2, 3, 4, 5]) {
      // Quantity = day, so every order's items are told apart.
      const order = await placeOrder(app, { items: [{ productId: 1, quantity: day }] });
      setCreatedAt(db, order.id, `2026-03-0${day}T10:00:00.000Z`);
      placed.push(order);
    }
    const [o1, o2, o3, o4, o5] = placed as [Order, Order, Order, Order, Order];

    const get = async (query: string) => (await (await getAdminOrders(app, query)).json()) as OrderPage;

    const first = await get("?limit=2&offset=0");
    expect(first.items.map((o) => o.id)).toEqual([o5.id, o4.id]);
    expect(first.items.map((o) => o.items[0]?.quantity)).toEqual([5, 4]);
    expect(first.total).toBe(5);

    const second = await get("?limit=2&offset=2");
    expect(second.items.map((o) => o.id)).toEqual([o3.id, o2.id]);
    expect(second.items.map((o) => o.items[0]?.quantity)).toEqual([3, 2]);

    const last = await get("?limit=2&offset=4");
    expect(last.items.map((o) => o.id)).toEqual([o1.id]);
    expect(last.total).toBe(5);

    expect(await get("?limit=2&offset=10")).toEqual({ items: [], total: 5 });
  });

  it("defaults to a page of 20 orders", async () => {
    const { app, db } = setup();
    for (let i = 0; i < 21; i++) {
      createOrder(db, { ...orderBody(), currency: "CZK" });
    }
    const page = (await (await getAdminOrders(app)).json()) as OrderPage;
    expect(page.items).toHaveLength(20);
    expect(page.total).toBe(21);
  });

  it("rejects an invalid page query", async () => {
    const { app } = setup();
    for (const query of ["?limit=0", "?limit=101", "?offset=-1", "?limit=abc"]) {
      expect((await getAdminOrders(app, query)).status).toBe(422);
    }
  });
});
