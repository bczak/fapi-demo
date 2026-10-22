import { randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { createDb } from "./db/client";
import { seedProducts } from "./db/seed";
import { ADMIN, postJson, SAMPLE_RATES, validCustomer } from "./test-utils";

const order = (overrides: object = {}) => ({
  idempotencyKey: randomUUID(),
  customer: validCustomer,
  items: [{ productId: 1, quantity: 1 }],
  ...overrides,
});

function build(limits: Parameters<typeof createApp>[0]["limits"] = {}) {
  let t = 0;
  const db = createDb(":memory:");
  seedProducts(db);
  const app = createApp({
    db,
    getRates: async () => SAMPLE_RATES,
    admin: ADMIN,
    limits,
    now: () => t,
    clientKey: (c) => c.req.header("x-client") ?? "anon",
  });
  const post = (body: unknown, client = "a") => {
    const init = postJson(body);
    return app.request("/api/orders", { ...init, headers: { ...init.headers, "x-client": client } });
  };
  const advance = (ms: number) => {
    t += ms;
  };
  return { app, db, post, advance };
}

afterEach(() => vi.restoreAllMocks());

describe("error responses", () => {
  const postRaw = (app: ReturnType<typeof build>["app"], body?: string) =>
    app.request("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body });

  it("answers 400 JSON, without logging an error, for a malformed or empty JSON body", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app } = build();
    for (const body of ["{not json", "", undefined]) {
      const res = await postRaw(app, body);
      expect(res.status, String(body)).toBe(400);
      expect(res.headers.get("Content-Type")).toContain("application/json");
      expect(await res.json()).toEqual({ message: "Malformed JSON in request body" });
    }
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps the status and message of any thrown 4xx HTTPException", async () => {
    const { app } = build();
    app.get("/api/conflict", () => {
      throw new HTTPException(409, { message: "Already there" });
    });
    const res = await app.request("/api/conflict");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "Already there" });
  });

  it("answers with the response a 4xx HTTPException carries, headers included", async () => {
    const { app } = build();
    app.get("/api/challenge", () => {
      const res = new Response("Sign in first", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
      throw new HTTPException(401, { res });
    });
    const res = await app.request("/api/challenge");
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(await res.text()).toBe("Sign in first");
  });

  it("answers 500 and logs anything unexpected", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { app, db } = build();
    db.$client.close();
    const res = await app.request("/api/products");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: "Internal server error" });
    expect(error).toHaveBeenCalledOnce();
  });
});

describe("POST /api/orders request size", () => {
  it("rejects bodies over the limit with 413 and creates nothing", async () => {
    const { post } = build({ orderBodyBytes: 2048 });
    const res = await post(order({ customer: { ...validCustomer, firstName: "x".repeat(5000) } }));
    expect(res.status).toBe(413);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ message: "Request body too large" });
  });

  it("accepts a normal order under the default 32 KB limit", async () => {
    const { post } = build();
    expect((await post(order())).status).toBe(201);
  });

  it("measures the streamed body when there is no trustworthy Content-Length", async () => {
    const { app } = build({ orderBodyBytes: 2048 });
    const body = JSON.stringify(order({ customer: { ...validCustomer, firstName: "x".repeat(5000) } }));
    const res = await app.request("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" },
      body,
    });
    expect(res.status).toBe(413);
  });
});

describe("POST /api/orders throttling", () => {
  it("answers 429 with Retry-After after too many submissions, even invalid ones", async () => {
    const { post } = build({ orderSubmissions: { max: 2, windowMs: 60_000 } });
    expect((await post(order())).status).toBe(201);
    expect((await post({})).status).toBe(422);

    const res = await post(order());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("is per client and recovers after the window", async () => {
    const { post, advance } = build({ orderSubmissions: { max: 1, windowMs: 60_000 } });
    expect((await post(order(), "a")).status).toBe(201);
    expect((await post(order(), "a")).status).toBe(429);
    expect((await post(order(), "b")).status).toBe(201);

    advance(60_000);
    expect((await post(order(), "a")).status).toBe(201);
  });

  it("does not throttle reading orders", async () => {
    const { app, post } = build({ orderSubmissions: { max: 1, windowMs: 60_000 } });
    const created = (await (await post(order())).json()) as { id: string };
    for (let i = 0; i < 3; i++) {
      expect((await app.request(`/api/orders/${created.id}`)).status).toBe(200);
    }
  });
});
