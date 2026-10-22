import { describe, expect, it } from "vitest";
import { calcTotals, convertFromCzk, convertFromCzkMinor, quotePayment } from "./pricing";

describe("calcTotals", () => {
  it("sums lines and adds 21% VAT", () => {
    const totals = calcTotals([
      { unitPriceMinor: 10000, quantity: 2 }, // 200 Kč
      { unitPriceMinor: 5050, quantity: 1 }, // 50.50 Kč
    ]);
    expect(totals).toEqual({ subtotalMinor: 25050, vatMinor: 5261, totalMinor: 30311 });
  });

  it("returns zeros for no lines", () => {
    expect(calcTotals([])).toEqual({ subtotalMinor: 0, vatMinor: 0, totalMinor: 0 });
  });

  it("supports a custom VAT rate", () => {
    expect(calcTotals([{ unitPriceMinor: 10000, quantity: 1 }], 12).vatMinor).toBe(1200);
  });
});

describe("convertFromCzk", () => {
  it("converts using the rate", () => {
    // 1 000 Kč at 25 CZK/EUR = 40 EUR
    expect(convertFromCzk(100000, { amount: 1, rate: 25 })).toBe(40);
  });

  it("respects rates quoted per multiple units (e.g. 100 HUF)", () => {
    // 100 HUF = 6.2 CZK, so 62 Kč = 1000 HUF
    expect(convertFromCzk(6200, { amount: 100, rate: 6.2 })).toBe(1000);
  });

  it("can return whole minor units", () => {
    expect(convertFromCzkMinor(100000, { amount: 1, rate: 25 })).toBe(4000);
    expect(convertFromCzkMinor(7499580, { amount: 1, rate: 21.593 })).toBe(347315);
  });
});

describe("quotePayment", () => {
  const rates = {
    date: "2026-10-21",
    rates: [
      { country: "EMU", currency: "euro", code: "EUR", amount: 1, rate: 25 },
      { country: "USA", currency: "dolar", code: "USD", amount: 1, rate: 21.593 },
    ],
  };

  it("keeps CZK as is and needs no rates", () => {
    expect(quotePayment(12345, "CZK")).toEqual({
      currency: "CZK",
      rate: 1,
      rateDate: null,
      totalMinor: 12345,
    });
  });

  it("converts with the rate and records which rate and date were used", () => {
    expect(quotePayment(100000, "EUR", rates)).toEqual({
      currency: "EUR",
      rate: 25,
      rateDate: "2026-10-21",
      totalMinor: 4000,
    });
    expect(quotePayment(7499580, "USD", rates)?.totalMinor).toBe(347315);
  });

  it("is undefined when the rate is not available", () => {
    expect(quotePayment(1000, "EUR")).toBeUndefined();
    expect(quotePayment(1000, "USD", { date: "2026-10-21", rates: [] })).toBeUndefined();
  });
});
