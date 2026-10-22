import type { MiddlewareHandler } from "hono";

/** Responses must never be kept by browsers or shared caches. */
export const noStore: MiddlewareHandler = async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
};
