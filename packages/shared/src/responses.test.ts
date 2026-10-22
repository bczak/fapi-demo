import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { parseCnbRates } from "./cnb";
import { calcTotals, quotePayment, VAT_PERCENT } from "./pricing";
import {
  apiErrorSchema,
  cnbRatesSchema,
  orderPageSchema,
  orderSchema,
  productPageSchema,
  productSchema,
} from "./responses";

/** The value as it arrives over the wire. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

// Built with the same functions the API uses, so these are the payloads it really sends.
const rates = parseCnbRates(`21.10.2026 #203
země|měna|množství|kód|kurz
Maďarsko|forint|100|HUF|6,201
EMU|euro|1|EUR|24,330
USA|dolar|1|USD|22,915`);

const product = {
  id: 1,
  name: "Mug",
  description: "Ceramic, 300 ml",
  priceMinor: 24_900,
  imageUrl: "/images/mug.webp",
};

const lines = [{ productId: 1, productName: "Mug", unitPriceMinor: 24_900, quantity: 3 }];
const totals = calcTotals(lines);

const order = {
  id: "9b2c3a64-3f0e-4c5e-8a39-0d7c2f9c1a11",
  createdAt: "2026-10-21T08:15:42.123Z",
  customer: {
    firstName: "Jana",
    lastName: "Nováková",
    email: "jana@example.com",
    phone: "+420 123 456 789",
    street: "Dlouhá 1",
    city: "Praha",
    zip: "110 00",
  },
  items: lines,
  vatPercent: VAT_PERCENT,
  ...totals,
  payment: quotePayment(totals.totalMinor, "EUR", rates),
};

const czkOrder = { ...order, payment: quotePayment(totals.totalMinor, "CZK") };

describe("response schemas accept what the API sends", () => {
  it("a page of products, with and without an image", () => {
    const page = wire({ items: [product, { ...product, id: 2, imageUrl: null }], total: 14 });
    expect(productPageSchema.parse(page)).toEqual(page);
  });

  it("an order paid in EUR at the ČNB rate, and one paid in CZK", () => {
    expect(orderSchema.parse(wire(order))).toEqual(wire(order));
    expect(orderSchema.parse(wire(czkOrder))).toEqual(wire(czkOrder));
  });

  it("a page of the admin orders, also an empty one", () => {
    const page = wire({ items: [order, czkOrder], total: 31 });
    expect(orderPageSchema.parse(page)).toEqual(page);
    expect(orderPageSchema.parse({ items: [], total: 0 })).toEqual({ items: [], total: 0 });
  });

  it("the ČNB rates as parsed from the daily file", () => {
    expect(cnbRatesSchema.parse(wire(rates))).toEqual(rates);
  });

  it("error bodies, with and without validation issues", () => {
    expect(apiErrorSchema.parse({ message: "Order not found" })).toEqual({ message: "Order not found" });
    const invalid = {
      message: "Validation failed",
      issues: [{ path: "customer.email", message: "Enter a valid email address" }],
    };
    expect(apiErrorSchema.parse(invalid)).toEqual(invalid);
  });
});

describe("response schemas reject malformed answers", () => {
  it.each<[string, ZodType, unknown]>([
    ["a price sent as a string", productSchema, { ...product, priceMinor: "249.00" }],
    ["a price in major units", productSchema, { ...product, priceMinor: 249.5 }],
    [
      "a product without its image field",
      productSchema,
      { id: 1, name: "Mug", description: "", priceMinor: 1 },
    ],
    ["a page of products without its total", productPageSchema, { items: [product] }],
    [
      "an order in an unknown currency",
      orderSchema,
      { ...order, payment: { ...order.payment, currency: "GBP" } },
    ],
    [
      "a rate date in Czech format",
      orderSchema,
      { ...order, payment: { ...order.payment, rateDate: "21.10.2026" } },
    ],
    ["a creation time that is not ISO", orderSchema, { ...order, createdAt: "21. 10. 2026 8:15" }],
    ["a negative total", orderSchema, { ...order, totalMinor: -1 }],
    ["a line without a quantity", orderSchema, { ...order, items: [{ productId: 1, productName: "Mug" }] }],
    ["an order without a customer", orderSchema, { ...order, customer: undefined }],
    ["a bare list instead of a page", orderPageSchema, [order]],
    ["a lower-case currency code", cnbRatesSchema, { ...rates, rates: [{ ...rates.rates[0], code: "huf" }] }],
    ["a rate of zero", cnbRatesSchema, { ...rates, rates: [{ ...rates.rates[0], rate: 0 }] }],
    ["an error without a message", apiErrorSchema, { error: "Not found" }],
    ["issues that are plain strings", apiErrorSchema, { message: "Validation failed", issues: ["email"] }],
    ["no body at all", orderSchema, undefined],
  ])("%s", (_, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
