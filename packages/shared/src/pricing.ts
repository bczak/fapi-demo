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

/** A ČNB rate (at most 3 decimals) as a whole number of thousandths, e.g. 21.593 -> 21593n. */
function rateInThousandths(rate: number): bigint {
  const thousandths = Math.round(rate * 1000);
  if (!Number.isSafeInteger(thousandths) || thousandths <= 0 || thousandths / 1000 !== rate) {
    throw new RangeError(`Exchange rate ${rate} is not a positive number with at most 3 decimals`);
  }
  return BigInt(thousandths);
}

/**
 * Converts CZK minor units into whole minor units of a foreign currency written with `digits` decimals
 * (cents by default). Exact integer maths, rounded once, half up.
 */
export function convertFromCzkMinor(
  czkMinor: number,
  rate: Pick<CnbRate, "amount" | "rate">,
  digits = 2,
): number {
  if (!Number.isSafeInteger(czkMinor) || czkMinor < 0) {
    throw new RangeError(`CZK amount ${czkMinor} is not a whole, non-negative number of haléře`);
  }
  // czkMinor / 100 CZK ÷ (thousandths / 1000 CZK per `amount` units) × 10^digits
  const numerator = BigInt(czkMinor) * BigInt(rate.amount) * 10n ** BigInt(digits + 1);
  const denominator = rateInThousandths(rate.rate);
  return Number((2n * numerator + denominator) / (2n * denominator));
}

/** Same conversion in major units, e.g. 40.25 (EUR), or 13.333 with 3 `digits` (TND). */
export function convertFromCzk(czkMinor: number, rate: Pick<CnbRate, "amount" | "rate">, digits = 2): number {
  return convertFromCzkMinor(czkMinor, rate, digits) / 10 ** digits;
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
    // EUR and USD both have cents.
    totalMinor: convertFromCzkMinor(czkTotalMinor, rate, 2),
  };
}
