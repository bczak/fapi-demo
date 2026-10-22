import type { z } from "zod";
import type {
  apiErrorSchema,
  apiIssueSchema,
  cnbRateSchema,
  cnbRatesSchema,
  orderItemSchema,
  orderPageSchema,
  orderSchema,
  paymentQuoteSchema,
  productPageSchema,
  productSchema,
} from "./responses";

// The API's answers, derived from their schemas in ./responses (the field docs are there).
// All money amounts are integers in minor units (haléře), never floats.

export type Product = z.infer<typeof productSchema>;
export type ProductPage = z.infer<typeof productPageSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type PaymentQuote = z.infer<typeof paymentQuoteSchema>;
export type Order = z.infer<typeof orderSchema>;
export type OrderPage = z.infer<typeof orderPageSchema>;
export type CnbRate = z.infer<typeof cnbRateSchema>;
export type CnbRates = z.infer<typeof cnbRatesSchema>;
export type ApiIssue = z.infer<typeof apiIssueSchema>;
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
