import { describe, expect, it } from "vitest";
import { currencyDigits, formatCurrency } from "./format";

/** Intl separates thousands and the symbol with non-breaking spaces. */
const plain = (text: string) => text.replace(/\s/g, " ");

describe("currencyDigits", () => {
  it.each([
    ["EUR", 2],
    ["USD", 2],
    ["CZK", 2],
    ["TND", 3],
    ["JPY", 0],
    ["ISK", 0],
  ])("%s is written with %i decimals", (currency, digits) => {
    expect(currencyDigits(currency)).toBe(digits);
  });

  it("matches what formatCurrency writes", () => {
    expect(plain(formatCurrency(13.333, "TND"))).toBe("13,333 TND");
    expect(plain(formatCurrency(6622, "JPY"))).toBe("6 622 JP¥");
    expect(plain(formatCurrency(4535.69, "USD"))).toBe("4 535,69 US$");
  });
});
