import type { CnbRate } from "@fapi/shared";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stubFetch } from "@/test/fetch";
import { renderWithClient } from "@/test/render";
import { CurrencyConverter } from "./CurrencyConverter";

const EUR: CnbRate = { country: "EMU", currency: "euro", code: "EUR", amount: 1, rate: 24.33 };
const USD: CnbRate = { country: "USA", currency: "dolar", code: "USD", amount: 1, rate: 20 };
const TND: CnbRate = { country: "Tunisko", currency: "dinár", code: "TND", amount: 1, rate: 7.5 };
const JPY: CnbRate = { country: "Japonsko", currency: "jen", code: "JPY", amount: 100, rate: 15.123 };
const PHP: CnbRate = { country: "Filipíny", currency: "peso", code: "PHP", amount: 100, rate: 40.123 };

/** The converted total shown for `totalMinor`; without EUR in the rates, the converter shows the first currency. */
async function converted(totalMinor: number, ...rates: CnbRate[]) {
  stubFetch({ "GET /api/rates": () => Response.json({ date: "2026-10-21", rates }) });
  renderWithClient(<CurrencyConverter totalMinor={totalMinor} />);
  const total = await screen.findByTestId("converted-total");
  // Intl separates thousands and the symbol with non-breaking spaces.
  return total.textContent?.replace(/\s/g, " ");
}

describe("CurrencyConverter", () => {
  it("shows euros by default, in cents", async () => {
    // 100 Kč at 24,33 CZK/EUR = 4,110 1… EUR
    expect(await converted(10_000, USD, EUR)).toBe("4,11 €");
  });

  it("rounds an exact half cent up", async () => {
    // 3 × 24 990 Kč + 21 % VAT = 90 713,70 Kč; at 20 CZK/USD exactly 4 535,685 USD
    expect(await converted(9_071_370, USD)).toBe("4 535,69 US$");
  });

  it("keeps all 3 decimals of a currency written with 3", async () => {
    // 100 Kč at 7,5 CZK/TND = 13,333… TND
    expect(await converted(10_000, TND)).toBe("13,333 TND");
  });

  it("rounds a currency without decimals only once", async () => {
    // 1 001,52 Kč at 15,123 CZK per 100 JPY = 6 622,49… JPY (6 622,50 rounded again would be 6 623)
    expect(await converted(100_152, JPY)).toBe("6 622 JP¥");
  });

  it("converts a currency quoted per 100 units", async () => {
    // 1 000 Kč at 40,123 CZK per 100 PHP = 2 492,336… PHP
    expect(await converted(100_000, PHP)).toBe("2 492,34 PHP");
  });
});
