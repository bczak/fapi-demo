import { type ProductPage, productsQuerySchema } from "@fapi/shared";
import { count, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../../db/client";
import { products } from "../../db/schema";
import { validate } from "../../validation";

export function productsRoutes(db: Db) {
  return new Hono()
    .get("/", validate("query", productsQuerySchema), (c) => {
      const { limit, offset, ids } = c.req.valid("query");
      // With `ids` a cart checks its lines: those products in id order, without the ones that are gone.
      const items = ids
        ? db.select().from(products).where(inArray(products.id, ids)).orderBy(products.id).all()
        : db.select().from(products).orderBy(products.id).limit(limit).offset(offset).all();
      const total = db.select({ n: count() }).from(products).get()?.n ?? 0;
      return c.json<ProductPage>({ items, total });
    })
    .get("/:id", validate("param", z.object({ id: z.coerce.number().int().positive() })), (c) => {
      const { id } = c.req.valid("param");
      const product = db.select().from(products).where(eq(products.id, id)).get();
      return product ? c.json(product) : c.json({ message: "Product not found" }, 404);
    });
}
