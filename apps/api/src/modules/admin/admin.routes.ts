import { adminOrdersQuerySchema } from "@fapi/shared";
import { Hono } from "hono";
import type { Db } from "../../db/client";
import { noStore } from "../../middleware/no-store";
import { type RateLimiter, rateLimit } from "../../middleware/rate-limit";
import { validate } from "../../validation";
import { listOrders } from "../orders/orders.service";
import { type AdminAuthOptions, adminAuth } from "./admin.auth";

export interface AdminRoutesOptions extends AdminAuthOptions {
  /** Caps all admin requests per client, authenticated or not. */
  requests: RateLimiter;
}

export function adminRoutes(db: Db, options: AdminRoutesOptions) {
  return new Hono()
    .use(noStore, rateLimit(options.requests, options.clientKey), adminAuth(options))
    .get("/orders", validate("query", adminOrdersQuerySchema), (c) =>
      c.json(listOrders(db, c.req.valid("query"))),
    );
}
