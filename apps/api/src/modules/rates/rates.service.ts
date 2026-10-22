import { type CnbRates, PAYMENT_CURRENCIES, parseCnbRates } from "@fapi/shared";

const CNB_URL =
  "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt";

/** ČNB quotes everything in CZK, so CZK itself is never listed. */
const REQUIRED_CODES = PAYMENT_CURRENCIES.filter((code) => code !== "CZK");

interface Options {
  fetch?: typeof fetch;
  ttlMs?: number;
  /** After a failed refresh, how long the cached rates are served before ČNB is asked again. */
  backoffMs?: number;
  now?: () => number;
  warn?: (message: string) => void;
}

/** A well-formed file without one of our payment currencies would break checkout in it, so it is invalid. */
function requirePaymentCurrencies(data: CnbRates): CnbRates {
  const missing = REQUIRED_CODES.filter((code) => !data.rates.some((rate) => rate.code === code));
  if (missing.length > 0) throw new Error(`ČNB rates are missing ${missing.join(", ")}`);
  return data;
}

async function fetchRates(fetchFn: typeof fetch): Promise<CnbRates> {
  const res = await fetchFn(CNB_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`ČNB responded with ${res.status}`);
  return requirePaymentCurrencies(parseCnbRates(await res.text()));
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Fetches ČNB daily rates, cached in memory; concurrent callers share one request.
 * If ČNB is unreachable or answers nonsense, the stale rates are served and ČNB is left alone for `backoffMs`.
 */
export function createRatesService({
  fetch: fetchFn = fetch,
  ttlMs = 60 * 60 * 1000,
  backoffMs = 60 * 1000,
  now = Date.now,
  warn = console.warn,
}: Options = {}) {
  let cached: { data: CnbRates; fetchedAt: number } | undefined;
  let retryAt = 0;
  let pending: Promise<CnbRates> | undefined;

  async function refresh(): Promise<CnbRates> {
    try {
      const data = await fetchRates(fetchFn);
      cached = { data, fetchedAt: now() };
      return data;
    } catch (e) {
      if (!cached) throw e;
      retryAt = now() + backoffMs;
      warn(`ČNB rates refresh failed (${errorMessage(e)}), serving rates from ${cached.data.date}`);
      return cached.data;
    }
  }

  return async function getRates(): Promise<CnbRates> {
    const t = now();
    if (cached && (t - cached.fetchedAt < ttlMs || t < retryAt)) return cached.data;
    pending ??= refresh().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
