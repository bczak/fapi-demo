import type { CnbRates } from "@fapi/shared";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { type AppLimits, defaultLimits } from "./config";
import type { Db } from "./db/client";
import { remoteAddress } from "./middleware/client-key";
import { noStore } from "./middleware/no-store";
import { type ClientKey, type Clock, createRateLimiter, rateLimit } from "./middleware/rate-limit";
import type { AdminCredentials } from "./modules/admin/admin.auth";
import { adminRoutes } from "./modules/admin/admin.routes";
import { ordersRoutes } from "./modules/orders/orders.routes";
import { productsRoutes } from "./modules/products/products.routes";
import { ratesRoutes } from "./modules/rates/rates.routes";

export interface AppDeps {
  db: Db;
  getRates: () => Promise<CnbRates>;
  admin: AdminCredentials;
  log?: boolean;
  limits?: Partial<AppLimits>;
  /** Clock for the rate limiters (ms), injectable so tests never sleep. */
  now?: Clock;
  /** Identifies the client for rate limiting; defaults to the connection's remote address. */
  clientKey?: ClientKey;
  /** Directory of the built web app. When set, it is served next to the API (production). */
  webDist?: string;
}

/**
 * Vite puts a content hash in every file under /assets, so those can be cached for good;
 * everything else (the index.html shell above all) is revalidated on every load.
 */
const withCaching =
  (serve: MiddlewareHandler): MiddlewareHandler =>
  async (c, next) => {
    const res = await serve(c, next);
    // Anything else means no file was found and the request went on to the next handler.
    if (res instanceof Response) {
      const hashed = c.req.path.startsWith("/assets/") && !res.headers.get("Content-Type")?.includes("html");
      res.headers.set("Cache-Control", hashed ? "public, max-age=31536000, immutable" : "no-cache");
    }
    return res;
  };

export function createApp({
  db,
  getRates,
  admin,
  log = false,
  limits: limitOverrides,
  now = Date.now,
  clientKey = remoteAddress,
  webDist,
}: AppDeps) {
  const limits = { ...defaultLimits, ...limitOverrides };
  const app = new Hono();
  if (log) app.use(logger());

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.route("/api/products", productsRoutes(db));
  app.post(
    "/api/orders",
    // Before the limits, so their 413 and 429 answers carry it too, like every other orders response.
    noStore,
    rateLimit(createRateLimiter(limits.orderSubmissions, now), clientKey),
    bodyLimit({
      maxSize: limits.orderBodyBytes,
      onError: (c) => c.json({ message: "Request body too large" }, 413),
    }),
  );
  app.route("/api/orders", ordersRoutes(db, getRates));
  app.route("/api/rates", ratesRoutes(getRates));
  app.route(
    "/api/admin",
    adminRoutes(db, {
      credentials: admin,
      failures: createRateLimiter(limits.adminFailures, now),
      requests: createRateLimiter(limits.adminRequests, now),
      clientKey,
    }),
  );

  if (webDist) {
    app.use("*", withCaching(serveStatic({ root: webDist })));
    // Client-side routes (/admin, /thank-you/…) get the app shell; unknown /api paths stay JSON 404s.
    const shell = withCaching(serveStatic({ root: webDist, path: "index.html" }));
    app.get("*", (c, next) => (c.req.path.startsWith("/api/") ? next() : shell(c, next)));
  }

  app.notFound((c) => c.json({ message: "Not found" }, 404));
  app.onError((err, c) => {
    // Thrown by Hono itself for bad requests, e.g. the validator on a malformed JSON body. One that
    // carries a ready response (headers such as WWW-Authenticate included) is answered with it.
    if (err instanceof HTTPException && err.status < 500) {
      return err.res ? err.getResponse() : c.json({ message: err.message }, err.status);
    }
    console.error(err);
    return c.json({ message: "Internal server error" }, 500);
  });

  return app;
}
