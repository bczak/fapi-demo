import type { CnbRates } from "@fapi/shared";
import { Hono } from "hono";

export function ratesRoutes(getRates: () => Promise<CnbRates>) {
  return new Hono().get("/", async (c) => {
    try {
      return c.json(await getRates());
    } catch (e) {
      console.error("Failed to load ČNB rates", e);
      return c.json({ message: "Exchange rates are currently unavailable" }, 502);
    }
  });
}
