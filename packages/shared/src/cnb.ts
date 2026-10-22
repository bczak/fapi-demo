import type { CnbRate, CnbRates } from "./types";

const DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s|$)/;
const COLUMNS = "země|měna|množství|kód|kurz";
const AMOUNT_RE = /^\d+$/;
// ČNB publishes 3 decimals; the FX maths relies on there being no more.
const RATE_RE = /^\d+(?:,\d{1,3})?$/;
const CODE_RE = /^[A-Z]{3}$/;

function invalid(detail: string): Error {
  return new Error(`Unexpected ČNB rates format: ${detail}`);
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseDate(head: string | undefined): string {
  const match = head?.match(DATE_RE);
  if (!match) throw invalid("missing date");
  const [, dd = "", mm = "", yyyy = ""] = match;
  if (!isCalendarDate(Number(yyyy), Number(mm), Number(dd))) {
    throw invalid(`invalid date "${head}"`);
  }
  return `${yyyy}-${mm}-${dd}`;
}

function parseRow(row: string): CnbRate {
  const fields = row.split("|");
  const [country, currency, amount = "", code = "", rate = ""] = fields;
  const parsedAmount = Number(amount);
  const parsedRate = Number(rate.replace(",", "."));
  if (
    fields.length !== 5 ||
    !country ||
    !currency ||
    !CODE_RE.test(code) ||
    !AMOUNT_RE.test(amount) ||
    !Number.isSafeInteger(parsedAmount) ||
    parsedAmount <= 0 ||
    !RATE_RE.test(rate) ||
    !Number.isFinite(parsedRate) ||
    parsedRate <= 0
  ) {
    throw invalid(`"${row}"`);
  }
  return { country, currency, code, amount: parsedAmount, rate: parsedRate };
}

/**
 * Parses ČNB's daily exchange rate file (denni_kurz.txt):
 *
 *   21.10.2026 #203
 *   země|měna|množství|kód|kurz
 *   Austrálie|dolar|1|AUD|15,191
 *
 * Strict: an unexpected column header, any malformed row, duplicate code or empty list throws, so a bad
 * response can never replace good data.
 */
export function parseCnbRates(text: string): CnbRates {
  const [head, columns, ...rows] = text.trim().split(/\r?\n/);
  const date = parseDate(head);
  if (columns !== COLUMNS) throw invalid(`unexpected column header "${columns ?? ""}"`);
  const rates = rows.map(parseRow);

  if (rates.length === 0) throw invalid("no rates");
  const codes = new Set(rates.map((rate) => rate.code));
  if (codes.size !== rates.length) throw invalid("duplicate currency codes");

  return { date, rates };
}
