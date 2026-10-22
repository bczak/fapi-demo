import type { PaymentCurrency } from "./schemas";
import type { CnbRate, CnbRates, PaymentQuote } from "./types";

export const VAT_PERCENT = 21;

export interface Totals {
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
}

export function calcTotals(
  lines: ReadonlyArray<{ unitPriceMinor: number; quantity: number }>,
  vatPercent: number = VAT_PERCENT,
): Totals {
  const subtotalMinor = lines.reduce((sum, l) => sum + l.unitPriceMinor * l.quantity, 0);
  const vatMinor = Math.round((subtotalMinor * vatPercent) / 100);
  return { subtotalMinor, vatMinor, totalMinor: subtotalMinor + vatMinor };
}

/** Converts CZK minor units into a foreign currency amount (major units, 2 decimals). */
export function convertFromCzk(czkMinor: number, rate: Pick<CnbRate, "amount" | "rate">): number {
  const foreign = (czkMinor / 100 / rate.rate) * rate.amount;
  return Math.round(foreign * 100) / 100;
}

/** Same conversion, as a whole number of minor units (cents) of the foreign currency. */
export function convertFromCzkMinor(czkMinor: number, rate: Pick<CnbRate, "amount" | "rate">): number {
  return Math.round(convertFromCzk(czkMinor, rate) * 100);
}

/**
 * What the customer pays in `currency` for a CZK total. CZK needs no rates; the others are converted
 * with the ČNB rate. Returns undefined when the currency is not in the rates.
 * Used by the server (which stores it) and the checkout screen (which previews it), so they always agree.
 */
export function quotePayment(
  czkTotalMinor: number,
  currency: PaymentCurrency,
  rates?: CnbRates,
): PaymentQuote | undefined {
  if (currency === "CZK") return { currency, rate: 1, rateDate: null, totalMinor: czkTotalMinor };
  const rate = rates?.rates.find((r) => r.code === currency);
  if (!rates || !rate) return undefined;
  return {
    currency,
    rate: rate.rate / rate.amount,
    rateDate: rates.date,
    totalMinor: convertFromCzkMinor(czkTotalMinor, rate),
  };
}
