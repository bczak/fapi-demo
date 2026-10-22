import { z } from "zod";
import { type Customer, PAYMENT_CURRENCIES } from "./schemas";

// What the API answers with. The web client checks every answer against these before using it.
// All money amounts are integers in minor units (haléře / cents), never floats.

const minorAmount = z.number().int().nonnegative();
const count = z.number().int().nonnegative();

export const productSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  /** Net price (without VAT) per piece, in haléře. */
  priceMinor: minorAmount,
  imageUrl: z.string().nullable(),
});

export const productPageSchema = z.object({
  items: z.array(productSchema),
  /** Number of products in the whole catalogue, not just this page. */
  total: count,
});

export const orderItemSchema = z.object({
  productId: z.number().int().positive(),
  productName: z.string(),
  unitPriceMinor: minorAmount,
  quantity: z.number().int().positive(),
});

/** What the customer pays: the CZK total converted into the chosen currency. */
export const paymentQuoteSchema = z.object({
  currency: z.enum(PAYMENT_CURRENCIES),
  /** CZK per 1 unit of `currency` (1 for CZK). */
  rate: z.number().positive(),
  /** Date of the ČNB rate used, ISO yyyy-mm-dd; null for CZK. */
  rateDate: z.iso.date().nullable(),
  /** Amount to pay, in minor units of `currency` (cents / haléře). */
  totalMinor: minorAmount,
});

// The customer as stored. It passed customerSchema when the order was placed; checking it against
// today's rules again would hide every order saved under older ones, so plain strings here.
const storedCustomerSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string(),
  street: z.string(),
  city: z.string(),
  zip: z.string(),
}) satisfies z.ZodType<Customer>;

export const orderSchema = z.object({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  customer: storedCustomerSchema,
  items: z.array(orderItemSchema),
  vatPercent: z.number().int().nonnegative(),
  subtotalMinor: minorAmount,
  vatMinor: minorAmount,
  /** Total incl. VAT in CZK. */
  totalMinor: minorAmount,
  payment: paymentQuoteSchema,
});

export const orderPageSchema = z.object({
  items: z.array(orderSchema),
  /** Number of orders in total, not just this page. */
  total: count,
});

export const cnbRateSchema = z.object({
  /** ISO 4217 code; the web formats amounts with it, which throws on anything else. */
  code: z.string().regex(/^[A-Z]{3}$/),
  currency: z.string(),
  country: z.string(),
  /** Number of foreign units the rate applies to (e.g. 100 for HUF). */
  amount: z.number().int().positive(),
  /** Price of `amount` foreign units in CZK. */
  rate: z.number().positive(),
});

export const cnbRatesSchema = z.object({
  /** Date the rates are valid for, ISO yyyy-mm-dd. */
  date: z.iso.date(),
  rates: z.array(cnbRateSchema),
});

export const apiIssueSchema = z.object({
  /** Dotted path of the invalid field, e.g. "customer.email". */
  path: z.string(),
  message: z.string(),
});

/** Body of every error answer; `issues` come with a rejected request body (422). */
export const apiErrorSchema = z.object({
  message: z.string(),
  issues: z.array(apiIssueSchema).optional(),
});
