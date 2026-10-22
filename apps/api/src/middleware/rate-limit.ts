import type { Context, MiddlewareHandler } from "hono";

export interface LimitOptions {
  max: number;
  windowMs: number;
}

export type Clock = () => number;
export type ClientKey = (c: Context) => string;

export interface RateLimiter {
  /** Seconds until `key` may act again, 0 while it is under the limit. */
  retryAfter(key: string): number;
  hit(key: string): void;
  reset(key: string): void;
}

const MAX_TRACKED_KEYS = 10_000;

/** In-memory fixed-window counter; a key's window starts at its first hit. */
export function createRateLimiter(
  { max, windowMs }: LimitOptions,
  now: Clock = Date.now,
  maxKeys = MAX_TRACKED_KEYS,
): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  // Every window is windowMs long and is queued when it starts, so the queue is ordered by expiry.
  // Eviction reads it from `head` instead of iterating the Map: on V8 a Map keeps a hole for every
  // deleted entry until it is rebuilt, and walking past them makes "drop the oldest" cost O(size).
  const queue: { key: string; resetAt: number }[] = [];
  let head = 0;

  const live = (key: string) => {
    const w = windows.get(key);
    if (w && w.resetAt > now()) return w;
    windows.delete(key);
    return undefined;
  };

  // A queued window is stale once its key was reset, expired early via `live`, or restarted.
  const isCurrent = (entry: { key: string; resetAt: number }) =>
    windows.get(entry.key)?.resetAt === entry.resetAt;

  // Keeps memory bounded when many distinct clients show up; each queued entry is looked at once.
  const makeRoom = () => {
    const t = now();
    for (let entry = queue[head]; entry; entry = queue[head]) {
      const current = isCurrent(entry);
      if (current && entry.resetAt > t) break;
      if (current) windows.delete(entry.key);
      head += 1;
    }
    const oldest = queue[head];
    if (windows.size >= maxKeys && oldest) {
      windows.delete(oldest.key);
      head += 1;
    }
    // Drop the consumed front once it is most of the array: amortised O(1) per entry.
    if (head > 1024 && head * 2 > queue.length) {
      queue.splice(0, head);
      head = 0;
    }
  };

  return {
    retryAfter(key) {
      const w = live(key);
      if (!w || w.count < max) return 0;
      return Math.max(1, Math.ceil((w.resetAt - now()) / 1000));
    },
    hit(key) {
      const w = live(key);
      if (w) {
        w.count += 1;
        return;
      }
      makeRoom();
      const resetAt = now() + windowMs;
      windows.set(key, { count: 1, resetAt });
      queue.push({ key, resetAt });
    },
    reset(key) {
      windows.delete(key);
    },
  };
}

export function tooManyRequests(c: Context, retryAfter: number) {
  c.header("Retry-After", String(retryAfter));
  return c.json({ message: "Too many requests" }, 429);
}

/** Counts every request per client and answers 429 once the limit is used up. */
export function rateLimit(limiter: RateLimiter, clientKey: ClientKey): MiddlewareHandler {
  return async (c, next) => {
    const key = clientKey(c);
    const retryAfter = limiter.retryAfter(key);
    if (retryAfter > 0) return tooManyRequests(c, retryAfter);
    limiter.hit(key);
    await next();
  };
}
