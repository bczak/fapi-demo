import { randomUUID } from "node:crypto";
import type { OrderPage } from "@fapi/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import { createDb } from "../../db/client";
import { seedProducts } from "../../db/seed";
import { postJson, SAMPLE_RATES, validCustomer } from "../../test-utils";
import { parseBasicAuth } from "./admin.auth";

const ACCENTED = { user: "příliš", password: "žluťoučký café" };

const basicFrom = (bytes: Uint8Array | string) => `Basic ${Buffer.from(bytes).toString("base64")}`;
const utf8Basic = (user: string, password: string) => basicFrom(`${user}:${password}`);

function build(options: Partial<Parameters<typeof createApp>[0]> = {}) {
  let t = 0;
  const db = createDb(":memory:");
  seedProducts(db);
  const app = createApp({
    db,
    getRates: async () => SAMPLE_RATES,
    admin: ACCENTED,
    now: () => t,
    clientKey: (c) => c.req.header("x-client") ?? "anon",
    ...options,
  });
  const get = (path: string, authorization?: string, client = "a") =>
    app.request(path, {
      headers: { ...(authorization && { Authorization: authorization }), "x-client": client },
    });
  const placeOrder = () =>
    app.request(
      "/api/orders",
      postJson({
        idempotencyKey: randomUUID(),
        customer: validCustomer,
        items: [{ productId: 1, quantity: 1 }],
      }),
    );
  const advance = (ms: number) => {
    t += ms;
  };
  return { app, get, placeOrder, advance };
}

const good = utf8Basic(ACCENTED.user, ACCENTED.password);

afterEach(() => vi.restoreAllMocks());

describe("admin Basic auth", () => {
  it("requires credentials and sends no WWW-Authenticate challenge", async () => {
    const { get } = build();
    const res = await get("/api/admin/orders");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("accepts configured non-ASCII credentials sent as UTF-8", async () => {
    const { get } = build();
    expect((await get("/api/admin/orders", good)).status).toBe(200);
  });

  it("accepts accents in only the password or only the user", async () => {
    const cafe = build({ admin: { user: "admin", password: "café" } });
    expect((await cafe.get("/api/admin/orders", utf8Basic("admin", "café"))).status).toBe(200);
    const user = build({ admin: { user: "příliš", password: "password" } });
    expect((await user.get("/api/admin/orders", utf8Basic("příliš", "password"))).status).toBe(200);
  });

  it("treats composed and decomposed accents as the same credentials", async () => {
    const { get } = build();
    const decomposed = utf8Basic(ACCENTED.user.normalize("NFD"), ACCENTED.password.normalize("NFD"));
    expect((await get("/api/admin/orders", decomposed)).status).toBe(200);
  });

  it("rejects wrong accented credentials", async () => {
    const { get } = build();
    for (const header of [
      utf8Basic("prilis", ACCENTED.password),
      utf8Basic(ACCENTED.user, "zlutoucky cafe"),
      utf8Basic(ACCENTED.user, "žluťoučký cafe"),
      utf8Basic("PŘÍLIŠ", ACCENTED.password),
    ]) {
      expect((await get("/api/admin/orders", header, header)).status).toBe(401);
    }
  });

  it("does not accept the latin1 encoding of the right credentials", async () => {
    const { get } = build({ admin: { user: "admin", password: "café" } });
    const res = await get("/api/admin/orders", basicFrom(Buffer.from("admin:café", "latin1")));
    expect(res.status).toBe(401);
  });

  it("answers 401, never 500, for malformed Authorization headers", async () => {
    const { get } = build();
    const headers = [
      "Basic",
      "Basic ",
      "Basic !!!not-base64!!!",
      "Basic a b c",
      `Basic ${Buffer.from("nocolon").toString("base64")}`,
      basicFrom(Uint8Array.of(0xff, 0xfe, 0x3a, 0xc3)),
      good.slice(0, -3),
      "Bearer abc",
      "Basic ====",
    ];
    for (const [i, header] of headers.entries()) {
      expect((await get("/api/admin/orders", header, `c${i}`)).status).toBe(401);
    }
  });
});

describe("parseBasicAuth", () => {
  it("splits on the first colon only, keeping colons in the password", () => {
    expect(parseBasicAuth(utf8Basic("café", "a:b:č"))).toEqual({ user: "café", password: "a:b:č" });
  });

  it("returns undefined for invalid base64 or invalid UTF-8", () => {
    expect(parseBasicAuth(undefined)).toBeUndefined();
    expect(parseBasicAuth("Basic %%%")).toBeUndefined();
    expect(parseBasicAuth(basicFrom(Uint8Array.of(0x61, 0x3a, 0xff)))).toBeUndefined();
  });
});

describe("admin rate limiting", () => {
  const limits = { adminFailures: { max: 3, windowMs: 60_000 } };

  it("answers 429 with Retry-After after repeated failures, even for the right password", async () => {
    const { get } = build({ limits });
    for (let i = 0; i < 3; i++)
      expect((await get("/api/admin/orders", utf8Basic("x", "y"))).status).toBe(401);

    const blocked = await get("/api/admin/orders", good);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect(blocked.headers.get("Cache-Control")).toBe("no-store");
  });

  it("lets the client retry after the window", async () => {
    const { get, advance } = build({ limits });
    for (let i = 0; i < 3; i++) await get("/api/admin/orders", utf8Basic("x", "y"));
    advance(60_000);
    expect((await get("/api/admin/orders", good)).status).toBe(200);
  });

  it("resets the failure counter after a successful login", async () => {
    const { get } = build({ limits });
    const bad = utf8Basic("x", "y");
    for (let round = 0; round < 3; round++) {
      await get("/api/admin/orders", bad);
      await get("/api/admin/orders", bad);
      expect((await get("/api/admin/orders", good)).status).toBe(200);
    }
    expect((await get("/api/admin/orders", bad)).status).toBe(401);
  });

  it("counts failures per client", async () => {
    const { get } = build({ limits });
    for (let i = 0; i < 3; i++) await get("/api/admin/orders", utf8Basic("x", "y"), "attacker");
    expect((await get("/api/admin/orders", utf8Basic("x", "y"), "attacker")).status).toBe(429);
    expect((await get("/api/admin/orders", good, "admin")).status).toBe(200);
  });

  it("keys clients by remote address by default, ignoring spoofed x-forwarded-for", async () => {
    const { app } = build({ limits, clientKey: undefined });
    const attempt = (n: number) =>
      app.request("/api/admin/orders", {
        headers: { Authorization: utf8Basic("x", "y"), "X-Forwarded-For": `10.0.0.${n}` },
      });
    for (let i = 0; i < 3; i++) expect((await attempt(i)).status).toBe(401);
    expect((await attempt(99)).status).toBe(429);
  });

  it("caps the total number of admin requests per client", async () => {
    const { get } = build({ limits: { adminRequests: { max: 2, windowMs: 60_000 } } });
    expect((await get("/api/admin/orders", good)).status).toBe(200);
    expect((await get("/api/admin/orders", good)).status).toBe(200);
    const res = await get("/api/admin/orders", good);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect((await get("/api/admin/orders", good, "other")).status).toBe(200);
  });
});

describe("admin responses", () => {
  it("are never cacheable", async () => {
    const { get } = build();
    expect((await get("/api/admin/orders", good)).headers.get("Cache-Control")).toBe("no-store");
    expect((await get("/api/admin/orders")).headers.get("Cache-Control")).toBe("no-store");
  });

  it("do not leak credentials into the request log", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => void lines.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args) => void lines.push(args.join(" ")));
    const { get } = build({ log: true });

    await get("/api/admin/orders", good);
    await get("/api/admin/orders", utf8Basic(ACCENTED.user, "wrong"));

    expect(lines.length).toBeGreaterThan(0);
    const logged = lines.join("\n");
    expect(logged).not.toContain(ACCENTED.password);
    expect(logged).not.toContain(good.slice(6));
    expect(logged).not.toContain("Authorization");
  });
});

describe("GET /api/admin/orders paging", () => {
  async function withOrders(count: number) {
    const ctx = build();
    for (let i = 0; i < count; i++) expect((await ctx.placeOrder()).status).toBe(201);
    return ctx;
  }
  const page = async (res: Response) => (await res.json()) as OrderPage;

  it("returns an OrderPage with the total and the default page size", async () => {
    const { get } = await withOrders(3);
    const res = await get("/api/admin/orders", good);
    expect(res.status).toBe(200);
    const body = await page(res);
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(3);
  });

  it("honours limit and offset", async () => {
    const { get } = await withOrders(3);
    const first = await page(await get("/api/admin/orders?limit=2&offset=0", good));
    const rest = await page(await get("/api/admin/orders?limit=2&offset=2", good));
    expect(first.items).toHaveLength(2);
    expect(rest.items).toHaveLength(1);
    expect(first.total).toBe(3);
    expect(rest.total).toBe(3);
    expect(new Set([...first.items, ...rest.items].map((o) => o.id)).size).toBe(3);
  });

  it("rejects an invalid query with 422", async () => {
    const { get } = build();
    for (const query of ["limit=0", "limit=101", "limit=abc", "offset=-1", "limit=1.5"]) {
      const res = await get(`/api/admin/orders?${query}`, good);
      expect(res.status, query).toBe(422);
    }
  });

  it("checks credentials before validating the query", async () => {
    const { get } = build();
    expect((await get("/api/admin/orders?limit=0")).status).toBe(401);
  });
});
