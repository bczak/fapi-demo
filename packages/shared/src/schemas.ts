import { z } from "zod";

export const MAX_QUANTITY = 99;
export const PRODUCTS_PAGE_SIZE = 12;
export const ADMIN_ORDERS_PAGE_SIZE = 20;

export const adminOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(ADMIN_ORDERS_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Currencies a customer can pay in. Prices are kept in CZK; the others use the ČNB rate. */
export const PAYMENT_CURRENCIES = ["CZK", "EUR", "USD"] as const;
export type PaymentCurrency = (typeof PAYMENT_CURRENCIES)[number];

export const productsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(PRODUCTS_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

const MAX_PHONE_LENGTH = 20;

export const customerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email: z.email("Enter a valid email address").max(200),
  phone: z
    .string()
    .trim()
    .refine((v) => {
      if (v.length > MAX_PHONE_LENGTH || !/^\+?[\d ]+$/.test(v)) return false;
      const digits = v.replace(/\D/g, "").length;
      return digits >= 9 && digits <= 15;
    }, "Enter a valid phone number"),
  street: z.string().trim().min(1, "Street is required").max(200),
  city: z.string().trim().min(1, "City is required").max(100),
  zip: z
    .string()
    .trim()
    .regex(/^\d{3} ?\d{2}$/, "Enter a valid ZIP"),
});

export const orderItemInputSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
});

export const createOrderSchema = z
  .object({
    customer: customerSchema,
    items: z.array(orderItemInputSchema).min(1, "Cart is empty").max(50),
    // Only the choice is sent; the server looks up the live ČNB rate and computes the amount itself.
    currency: z.enum(PAYMENT_CURRENCIES).default("CZK"),
    // One key per checkout attempt. Retrying with the same key must return the existing order, not a new one.
    // Random v4 only (no nil UUID that every client could share), lower-cased so case can't make a new key.
    idempotencyKey: z.uuidv4().toLowerCase(),
  })
  .superRefine(({ items }, ctx) => {
    // Duplicate lines are merged server-side, so the limit applies to the sum per product.
    const totals = new Map<number, number>();
    items.forEach(({ productId, quantity }, index) => {
      const total = (totals.get(productId) ?? 0) + quantity;
      totals.set(productId, total);
      // Report once per product: at the line that crosses the limit.
      if (total > MAX_QUANTITY && total - quantity <= MAX_QUANTITY) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "quantity"],
          message: `You can order at most ${MAX_QUANTITY} pieces of one product`,
        });
      }
    });
  });

export type Customer = z.infer<typeof customerSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
