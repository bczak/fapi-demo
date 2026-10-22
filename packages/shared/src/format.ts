/** Formats CZK minor units, e.g. 129900 -> "1 299 Kč". */
export function formatCzk(minor: number): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "CZK",
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

/** Formats minor units (cents / haléře) of a currency, e.g. 347315 + "USD" -> "3 473,15 US$". */
export function formatMinor(minor: number, currency: string): string {
  return currency === "CZK" ? formatCzk(minor) : formatCurrency(minor / 100, currency);
}

/** "2026-10-21" -> "21.10.2026". */
export function formatRateDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

const currencyFormat = (currency: string) => new Intl.NumberFormat("cs-CZ", { style: "currency", currency });

/** Formats a major-unit amount in an arbitrary ISO currency, with `currencyDigits(currency)` decimals. */
export function formatCurrency(amount: number, currency: string): string {
  return currencyFormat(currency).format(amount);
}

/** How many decimals a currency is written with: 2 for EUR, 3 for TND, 0 for JPY. */
export function currencyDigits(currency: string): number {
  return currencyFormat(currency).resolvedOptions().maximumFractionDigits ?? 2;
}
