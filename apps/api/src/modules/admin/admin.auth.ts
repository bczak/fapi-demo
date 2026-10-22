import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { type ClientKey, type RateLimiter, tooManyRequests } from "../../middleware/rate-limit";

export interface AdminCredentials {
  user: string;
  password: string;
}

export interface AdminAuthOptions {
  credentials: AdminCredentials;
  /** Failed attempts per client; a client at its limit is refused until the window ends. */
  failures: RateLimiter;
  clientKey: ClientKey;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });

// Compare NFC-normalised so "é" typed as one or two code points is the same password.
const digest = (s: string) => createHash("sha256").update(s.normalize("NFC")).digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** Decodes `Basic base64(utf8("user:password"))`; undefined for anything malformed. */
export function parseBasicAuth(header: string | undefined): AdminCredentials | undefined {
  const encoded = header?.match(/^Basic +(\S+)\s*$/i)?.[1];
  if (!encoded || !BASE64.test(encoded)) return undefined;
  let decoded: string;
  try {
    decoded = utf8.decode(Buffer.from(encoded, "base64"));
  } catch {
    return undefined;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return undefined;
  return { user: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

/**
 * HTTP Basic auth. Unlike hono/basic-auth it sends no `WWW-Authenticate` header,
 * so browsers don't pop up their native login dialog - the SPA renders its own form.
 */
export function adminAuth({ credentials, failures, clientKey }: AdminAuthOptions): MiddlewareHandler {
  return async (c, next) => {
    const key = clientKey(c);
    const retryAfter = failures.retryAfter(key);
    if (retryAfter > 0) return tooManyRequests(c, retryAfter);

    const given = parseBasicAuth(c.req.header("Authorization"));
    // Evaluate both so the check takes the same time whichever part is wrong.
    const userOk = safeEqual(given?.user ?? "", credentials.user);
    const passwordOk = safeEqual(given?.password ?? "", credentials.password);
    if (!given || !userOk || !passwordOk) {
      failures.hit(key);
      return c.json({ message: "Unauthorized" }, 401);
    }

    failures.reset(key);
    await next();
  };
}
