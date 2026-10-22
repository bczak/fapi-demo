import { type ApiErrorBody, type CnbRates, createOrderSchema } from "@fapi/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client";
import { noStore } from "../../middleware/no-store";
import { validate } from "../../validation";
import {
  createOrder,
  findOrderByKey,
  getOrder,
  IdempotencyConflictError,
  PriceChangedError,
  QuantityLimitError,
  UnknownProductError,
  UnsupportedCurrencyError,
} from "./orders.service";

export function ordersRoutes(db: Db, getRates: () => Promise<CnbRates>) {
  return (
    new Hono()
      // Orders carry personal data, so no answer here may end up in a shared or browser cache.
      .use(noStore)
      .post("/", validate("json", createOrderSchema), async (c) => {
        const input = c.req.valid("json");

        try {
          // A retry gets its order back even when ČNB is down.
          const existing = findOrderByKey(db, input);
          if (existing) return c.json(existing, 200);

          // CZK needs no rates, so ordering keeps working when ČNB is down.
          let rates: CnbRates | undefined;
          if (input.currency !== "CZK") {
            try {
              rates = await getRates();
            } catch (e) {
              console.error("Failed to load ČNB rates", e);
              return c.json({ message: "Exchange rates are currently unavailable" }, 502);
            }
          }

          const { order, created } = createOrder(db, input, rates);
          return c.json(order, created ? 201 : 200);
        } catch (e) {
          // Only the message: the order behind the key belongs to someone else's request.
          if (e instanceof IdempotencyConflictError) {
            return c.json({ message: e.message, code: "idempotency_conflict" } satisfies ApiErrorBody, 409);
          }
          // Nothing was saved, so the key stays free for the order at the new total.
          if (e instanceof PriceChangedError) {
            return c.json({ message: e.message, code: "price_changed" } satisfies ApiErrorBody, 409);
          }
          if (
            e instanceof UnknownProductError ||
            e instanceof UnsupportedCurrencyError ||
            e instanceof QuantityLimitError
          ) {
            return c.json({ message: e.message }, 422);
          }
          throw e;
        }
      })
      // The id is a random UUID, so it doubles as an unguessable link to the thank-you page.
      .get("/:id", validate("param", z.object({ id: z.uuid() })), (c) => {
        const order = getOrder(db, c.req.valid("param").id);
        return order ? c.json(order) : c.json({ message: "Order not found" }, 404);
      })
  );
}
