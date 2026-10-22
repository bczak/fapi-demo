import type { LimitOptions } from "./middleware/rate-limit";

/**
 * TRUST_PROXY is the number of trusted reverse proxies in front of the app that each append their peer
 * to x-forwarded-for; clients are then keyed by the N-th entry from the right. "true" means one proxy
 * (Railway), i.e. the last entry. Unset, "false", "0" or anything else ignores the header, which clients
 * can forge, and keys on the socket address. Never set it higher than the real number of proxies.
 */
export function parseTrustProxy(value: string | undefined): number {
  const setting = value?.trim().toLowerCase() ?? "";
  if (setting === "true") return 1;
  return /^\d+$/.test(setting) ? Number(setting) : 0;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "./data/shop.db",
  adminUser: process.env.ADMIN_USER ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "password",
  proxyHops: parseTrustProxy(process.env.TRUST_PROXY),
  // Built web app to serve from the same origin (production image); unset in development.
  webDist: process.env.WEB_DIST || undefined,
};

export interface AppLimits {
  adminRequests: LimitOptions;
  adminFailures: LimitOptions;
  orderSubmissions: LimitOptions;
  orderBodyBytes: number;
}

const MINUTE = 60_000;

export const defaultLimits: AppLimits = {
  adminRequests: { max: 120, windowMs: MINUTE },
  adminFailures: { max: 5, windowMs: MINUTE },
  orderSubmissions: { max: 30, windowMs: MINUTE },
  orderBodyBytes: 32 * 1024,
};
