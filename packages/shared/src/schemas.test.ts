import { describe, expect, it } from "vitest";
import { createOrderSchema, customerSchema } from "./schemas";

const valid = {
  firstName: "Jan",
  lastName: "Novák",
  email: "jan@example.com",
  phone: "+420 123 456 789",
  street: "Hlavní 1",
  city: "Praha",
  zip: "110 00",
};

describe("customerSchema", () => {
  it("accepts valid data", () => {
    expect(customerSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["email", "not-an-email"],
    ["phone", "12345"],
    ["phone", "abc123456789"],
    ["zip", "1100"],
    ["firstName", "   "],
  ])("rejects invalid %s (%s)", (field, value) => {
    expect(customerSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it("accepts a phone without country prefix", () => {
    expect(customerSchema.safeParse({ ...valid, phone: "123456789" }).success).toBe(true);
  });
});

describe("customerSchema phone length", () => {
  it("accepts a phone of at most 20 characters", () => {
    expect(customerSchema.safeParse({ ...valid, phone: "+420 123 456 789 012" }).success).toBe(true);
  });

  it("rejects a phone padded with spaces beyond 20 characters", () => {
    const phone = `+420${" ".repeat(30)}123456789`;
    expect(customerSchema.safeParse({ ...valid, phone }).success).toBe(false);
  });
});

describe("createOrderSchema", () => {
  const key = "3f6c8a52-5b0e-4c43-9a43-1f2b6d3a9c11";
  const order = (items: { productId: number; quantity: number }[]) => ({
    customer: valid,
    items,
    idempotencyKey: key,
  });

  it("requires at least one item", () => {
    expect(createOrderSchema.safeParse(order([])).success).toBe(false);
  });

  it("rejects non-positive quantities", () => {
    expect(createOrderSchema.safeParse(order([{ productId: 1, quantity: 0 }])).success).toBe(false);
  });

  it("requires a UUID idempotency key", () => {
    const body = order([{ productId: 1, quantity: 1 }]);
    expect(createOrderSchema.safeParse({ ...body, idempotencyKey: undefined }).success).toBe(false);
    expect(createOrderSchema.safeParse({ ...body, idempotencyKey: "abc" }).success).toBe(false);
    expect(createOrderSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ["the nil UUID", "00000000-0000-0000-0000-000000000000"],
    ["the max UUID", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
    ["a v1 UUID", "3f6c8a52-5b0e-1c43-9a43-1f2b6d3a9c11"],
    ["a v7 UUID", "0192b1c4-5b0e-7c43-9a43-1f2b6d3a9c11"],
  ])("rejects %s as idempotency key, accepting only random v4 ones", (_, idempotencyKey) => {
    const body = order([{ productId: 1, quantity: 1 }]);
    expect(createOrderSchema.safeParse({ ...body, idempotencyKey }).success).toBe(false);
  });

  it("lower-cases the idempotency key, so case can't turn a retry into a new order", () => {
    const res = createOrderSchema.safeParse({
      ...order([{ productId: 1, quantity: 1 }]),
      idempotencyKey: key.toUpperCase(),
    });
    expect(res.data?.idempotencyKey).toBe(key);
  });

  it("accepts duplicate lines whose sum is within the limit", () => {
    const items = [
      { productId: 1, quantity: 98 },
      { productId: 1, quantity: 1 },
      { productId: 2, quantity: 99 },
    ];
    expect(createOrderSchema.safeParse(order(items)).success).toBe(true);
  });

  it("rejects duplicate lines whose sum exceeds the limit, pointing at the offending line", () => {
    const res = createOrderSchema.safeParse(
      order([
        { productId: 1, quantity: 99 },
        { productId: 2, quantity: 1 },
        { productId: 1, quantity: 99 },
        { productId: 1, quantity: 5 },
      ]),
    );
    expect(res.success).toBe(false);
    expect(res.error?.issues).toEqual([
      expect.objectContaining({
        path: ["items", 2, "quantity"],
        message: "You can order at most 99 pieces of one product",
      }),
    ]);
  });
});
