import { isIPv4, isIPv6 } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { ClientKey } from "./rate-limit";

const UNKNOWN = "unknown";

/** The eight 16-bit groups of a valid IPv6 address without a zone id. */
function ipv6Groups(ip: string): number[] {
  // A dotted IPv4 tail (::ffff:1.2.3.4) becomes two hex groups.
  const hex = ip.replace(
    /(\d+)\.(\d+)\.(\d+)\.(\d+)$/,
    (_, a: string, b: string, c: string, d: string) =>
      `${(Number(a) * 256 + Number(b)).toString(16)}:${(Number(c) * 256 + Number(d)).toString(16)}`,
  );
  const [head = "", tail] = hex.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...zeros, ...right].map((group) => Number.parseInt(group, 16));
}

/**
 * Rate-limit key for an address: IPv4 as is, IPv4-mapped IPv6 as its IPv4 address and any other
 * IPv6 address as its /64, since a single client usually gets a whole /64 to pick addresses from.
 */
export function normalizeAddress(address: string): string {
  // Some proxies add the client's port: "1.2.3.4:5678", "[2001:db8::1]:443".
  const host = address.trim().match(/^\[([^\]]+)\](?::\d+)?$|^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  const ip = (host?.[1] ?? host?.[2] ?? address.trim()).toLowerCase().replace(/%.*$/, "");
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return UNKNOWN;
  const groups = ipv6Groups(ip);
  const [hi = 0, lo = 0] = groups.slice(6);
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  const prefix = groups.slice(0, 4).map((g) => g.toString(16));
  return `${prefix.join(":")}::/64`;
}

/** The TCP peer address. Safe by default: headers such as x-forwarded-for are client-controlled. */
export function remoteAddress(c: Context): string {
  try {
    return normalizeAddress(getConnInfo(c).remote.address ?? UNKNOWN);
  } catch {
    // No Node socket (e.g. app.request in tests).
    return UNKNOWN;
  }
}

/**
 * For deployments behind `hops` trusted proxies that each append their peer to x-forwarded-for:
 * the client is the `hops`-th entry from the right, anything further left is client-supplied.
 */
export function forwardedAddress(hops: number): ClientKey {
  return (c) => {
    const entries = c.req.header("x-forwarded-for")?.split(",") ?? [];
    const entry = entries[entries.length - hops]?.trim();
    return entry ? normalizeAddress(entry) : remoteAddress(c);
  };
}
