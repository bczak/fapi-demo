import type { CnbRates, Customer, Order, Product } from "@fapi/shared";

export const customer: Customer = {
  firstName: "Jana",
  lastName: "Nováková",
  email: "jana@example.com",
  phone: "+420 123 456 789",
  street: "Dlouhá 1",
  city: "Praha",
  zip: "110 00",
};

export const product = (id: number): Product => ({
  id,
  name: `Product ${id}`,
  description: "",
  priceMinor: 10_000,
  imageUrl: null,
});

export const order = (id = "order-1", overrides: Partial<Order> = {}): Order => ({
  id,
  createdAt: "2026-01-01T10:00:00.000Z",
  customer,
  items: [{ productId: 1, productName: "Product 1", unitPriceMinor: 10_000, quantity: 2 }],
  vatPercent: 21,
  subtotalMinor: 20_000,
  vatMinor: 4200,
  totalMinor: 24_200,
  payment: { currency: "CZK", rate: 1, rateDate: null, totalMinor: 24_200 },
  ...overrides,
});

export const rates: CnbRates = {
  date: "2026-01-02",
  rates: [
    { code: "EUR", currency: "euro", country: "EMU", amount: 1, rate: 25 },
    { code: "USD", currency: "dollar", country: "USA", amount: 1, rate: 22 },
  ],
};
