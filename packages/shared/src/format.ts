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

/** Formats a major-unit amount in an arbitrary ISO currency. */
export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", { style: "currency", currency }).format(amount);
}
