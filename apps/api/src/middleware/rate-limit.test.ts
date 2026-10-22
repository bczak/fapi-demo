import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createRateLimiter, type RateLimiter, rateLimit } from "./rate-limit";

function clock(start = 1_000_000) {
  let t = start;
  const advance = (ms: number) => {
    t += ms;
  };
  return { now: () => t, advance };
}

describe("createRateLimiter", () => {
  it("allows up to max hits per window, then reports the seconds to wait", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 }, time.now);

    expect(limiter.retryAfter("a")).toBe(0);
    limiter.hit("a");
    expect(limiter.retryAfter("a")).toBe(0);
    limiter.hit("a");
    expect(limiter.retryAfter("a")).toBe(60);

    time.advance(45_500);
    expect(limiter.retryAfter("a")).toBe(15);
  });

  it("starts a fresh window once the old one has expired", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 }, time.now);
    limiter.hit("a");
    expect(limiter.retryAfter("a")).toBeGreaterThan(0);

    time.advance(1000);
    expect(limiter.retryAfter("a")).toBe(0);
  });

  it("tracks keys independently and can reset one", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 }, clock().now);
    limiter.hit("a");
    expect(limiter.retryAfter("a")).toBeGreaterThan(0);
    expect(limiter.retryAfter("b")).toBe(0);

    limiter.reset("a");
    expect(limiter.retryAfter("a")).toBe(0);
  });
});

describe("createRateLimiter key cap", () => {
  const blocked = (limiter: RateLimiter, keys: string[]) => keys.map((key) => limiter.retryAfter(key) > 0);

  it("forgets the oldest key once more keys than the cap show up", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 }, time.now, 3);
    for (const key of ["a", "b", "c", "d", "e"]) {
      limiter.hit(key);
      time.advance(1);
    }
    expect(blocked(limiter, ["a", "b", "c", "d", "e"])).toEqual([false, false, true, true, true]);
  });

  it("keeps every live key while expired ones make room", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 }, time.now, 3);
    limiter.hit("a");
    limiter.hit("b");
    time.advance(500);
    limiter.hit("c");
    time.advance(500);
    limiter.hit("d");
    limiter.hit("e");
    expect(blocked(limiter, ["c", "d", "e"])).toEqual([true, true, true]);
  });

  it("counts a key whose window restarted as the newest", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 }, time.now, 2);
    limiter.hit("a");
    time.advance(100);
    limiter.hit("b");
    time.advance(900);
    limiter.hit("a");
    time.advance(50);
    limiter.hit("c");
    expect(blocked(limiter, ["a", "b", "c"])).toEqual([true, false, true]);
  });

  it("does not look at every tracked key when a new one arrives at the cap", () => {
    const time = clock();
    let clockReads = 0;
    const now = () => {
      clockReads += 1;
      return time.now();
    };
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 }, now, 1000);
    for (let i = 0; i < 1000; i++) limiter.hit(`k${i}`);

    clockReads = 0;
    limiter.hit("one more");
    expect(clockReads).toBeLessThan(5);
    expect(blocked(limiter, ["k0", "k1", "one more"])).toEqual([false, true, true]);
  });

  it("keeps evicting cheaply under a flood of new keys at a large cap", () => {
    // Constant work per new key: 200k keys at a 50k cap take well under a second. Scanning the
    // tracked keys (or walking a Map's deleted slots) on every eviction takes many seconds.
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 }, clock().now, 50_000);
    const started = performance.now();
    for (let i = 0; i < 200_000; i++) limiter.hit(`k${i}`);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(blocked(limiter, ["k149999", "k150000", "k199999"])).toEqual([false, true, true]);
  }, 30_000);

  it("skips reset and restarted windows when evicting", () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 }, time.now, 2);
    limiter.hit("a");
    limiter.reset("a");
    limiter.hit("b");
    limiter.hit("c");
    limiter.hit("d");
    // "a" was reset, so its stale queue entry must not count: "b" is the oldest and goes first.
    expect(blocked(limiter, ["a", "b", "c", "d"])).toEqual([false, false, true, true]);
  });
});

describe("rateLimit middleware", () => {
  const build = () => {
    const time = clock();
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 }, time.now);
    const app = new Hono()
      .use(rateLimit(limiter, (c) => c.req.header("x-client") ?? "anon"))
      .get("/", (c) => c.text("ok"));
    return { app, time };
  };
  const get = (app: Hono, client: string) => app.request("/", { headers: { "x-client": client } });

  it("answers 429 with Retry-After once the client is over the limit", async () => {
    const { app } = build();
    expect((await get(app, "a")).status).toBe(200);
    expect((await get(app, "a")).status).toBe(200);

    const res = await get(app, "a");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({ message: "Too many requests" });
    expect((await get(app, "b")).status).toBe(200);
  });

  it("lets the client back in after the window", async () => {
    const { app, time } = build();
    for (let i = 0; i < 3; i++) await get(app, "a");
    time.advance(60_000);
    expect((await get(app, "a")).status).toBe(200);
  });
});
