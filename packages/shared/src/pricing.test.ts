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

  it("rounds an exact half cent up", () => {
    // 3 × 24 990 Kč net + 21 % VAT = 90 713,70 Kč; at 20 CZK/USD that is exactly 4 535,685 USD.
    const { totalMinor } = calcTotals([{ unitPriceMinor: 2_499_000, quantity: 3 }]);
    expect(totalMinor).toBe(9_071_370);
    expect(convertFromCzkMinor(totalMinor, { amount: 1, rate: 20 })).toBe(453_569);
    expect(convertFromCzk(totalMinor, { amount: 1, rate: 20 })).toBe(4535.69);
  });

  it.each([
    [70, { amount: 1, rate: 20 }, 4], // 0,035 USD
    [290, { amount: 1, rate: 20 }, 15], // 0,145 USD
    [116, { amount: 1, rate: 8 }, 15], // 0,145
    [232, { amount: 1, rate: 16 }, 15], // 0,145
    [1, { amount: 100, rate: 40 }, 3], // 0,025 per unit at 40 Kč per 100 units
  ])("rounds the half-unit boundary %i haléře at %o up to %i minor units", (czkMinor, rate, expected) => {
    expect(convertFromCzkMinor(czkMinor, rate)).toBe(expected);
  });

  it("rounds just below a half cent down", () => {
    // 0,034995 USD
    expect(convertFromCzkMinor(6_999, { amount: 1, rate: 2_000 })).toBe(3);
    // 4 535,6845 USD
    expect(convertFromCzkMinor(9_071_369, { amount: 1, rate: 20 })).toBe(453_568);
  });

  it("rounds once to the decimals the currency is written with", () => {
    // 100 Kč at 7,5 CZK/TND = 13,333… TND
    expect(convertFromCzk(10_000, { amount: 1, rate: 7.5 }, 3)).toBe(13.333);
    expect(convertFromCzkMinor(10_000, { amount: 1, rate: 7.5 }, 3)).toBe(13_333);
    // 0,0005 TND rounds up to 1 millime
    expect(convertFromCzkMinor(1, { amount: 1, rate: 20 }, 3)).toBe(1);
    // 1 001,52 Kč at 15,123 CZK per 100 JPY = 6 622,49… JPY, not 6 622,50 rounded again to 6 623
    expect(convertFromCzk(100_152, { amount: 100, rate: 15.123 }, 0)).toBe(6622);
    // 0,10 Kč at 20 CZK per 100 JPY = 0,5 JPY
    expect(convertFromCzk(10, { amount: 100, rate: 20 }, 0)).toBe(1);
  });

  it("does not overflow for the largest safe amount", () => {
    // 90 071 992 547 409,91 Kč at 21,593 CZK/USD = 4 171 351 481 841,796… USD
    expect(convertFromCzkMinor(Number.MAX_SAFE_INTEGER, { amount: 1, rate: 21.593 })).toBe(
      417_135_148_184_180,
    );
  });

  it.each([
    ["more than 3 decimals", 21.5934],
    ["zero", 0],
    ["negative", -25],
    ["not finite", Number.POSITIVE_INFINITY],
    ["not a number", Number.NaN],
  ])("refuses a rate that is %s", (_, rate) => {
    expect(() => convertFromCzkMinor(100, { amount: 1, rate })).toThrow(RangeError);
  });

  it.each([
    ["negative", -1],
    ["fractional", 0.5],
    ["not a number", Number.NaN],
  ])("refuses a CZK amount that is %s", (_, czkMinor) => {
    expect(() => convertFromCzkMinor(czkMinor, { amount: 1, rate: 25 })).toThrow(RangeError);
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

  it("rounds an exact half cent up", () => {
    const usdAt20 = {
      date: "2026-10-21",
      rates: [{ country: "USA", currency: "dolar", code: "USD", amount: 1, rate: 20 }],
    };
    // 90 713,70 Kč = 4 535,685 USD
    expect(quotePayment(9_071_370, "USD", usdAt20)?.totalMinor).toBe(453_569);
  });

  it("is undefined when the rate is not available", () => {
    expect(quotePayment(1000, "EUR")).toBeUndefined();
    expect(quotePayment(1000, "USD", { date: "2026-10-21", rates: [] })).toBeUndefined();
  });
});
