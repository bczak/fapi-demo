import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { forwardedAddress, normalizeAddress, remoteAddress } from "./client-key";
import type { ClientKey } from "./rate-limit";

describe("normalizeAddress", () => {
  it("keeps IPv4 addresses as they are", () => {
    expect(normalizeAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeAddress("10.0.0.1")).toBe("10.0.0.1");
  });

  it("keys IPv4-mapped IPv6 addresses by their IPv4 address", () => {
    for (const ip of [
      "::ffff:203.0.113.7",
      "::FFFF:203.0.113.7",
      "0:0:0:0:0:ffff:203.0.113.7",
      "0000:0000:0000:0000:0000:ffff:cb00:7107",
      "::ffff:cb00:7107",
    ]) {
      expect(normalizeAddress(ip), ip).toBe("203.0.113.7");
    }
  });

  it("keys every address of a /64 the same, however it is written", () => {
    for (const ip of [
      "2001:db8:1:2::1",
      "2001:0db8:0001:0002:0000:0000:0000:0001",
      "2001:DB8:1:2:FFFF:FFFF:FFFF:FFFF",
      "2001:db8:1:2:a:b:c:d",
      "2001:db8:1:2::",
      "2001:db8:1:2::1%eth0",
      "2001:db8:1:2::1.2.3.4",
      "2001:db8:1:2:0:ffff:1.2.3.4",
    ]) {
      expect(normalizeAddress(ip), ip).toBe("2001:db8:1:2::/64");
    }
  });

  it("expands :: to the right number of zero groups wherever it is", () => {
    expect(normalizeAddress("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeAddress("2001:db8::1:2:3:4")).toBe("2001:db8:0:0::/64");
    expect(normalizeAddress("1::2:3:4:5:6")).toBe("1:0:0:2::/64");
    expect(normalizeAddress("1:2:3::")).toBe("1:2:3:0::/64");
    expect(normalizeAddress("::1")).toBe("0:0:0:0::/64");
    expect(normalizeAddress("::")).toBe("0:0:0:0::/64");
  });

  it("drops the zone id of link-local addresses", () => {
    expect(normalizeAddress("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(normalizeAddress("FE80::abcd%25")).toBe("fe80:0:0:0::/64");
  });

  it("tells different /64s apart", () => {
    const keys = [
      "2001:db8:1:2::1",
      "2001:db8:1:3::1",
      "2001:db8::1:2:0:1",
      "2001:db9:1:2::1",
      "fe80::1",
      "203.0.113.7",
    ].map(normalizeAddress);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("falls back to a fixed key for anything that is not an IP address", () => {
    for (const junk of [
      "",
      "unknown",
      "not-an-ip",
      "1.2.3.256",
      "1.2.3",
      "01.2.3.4",
      "1.2.3.4:",
      "1.2.3.4:http",
      "2001:db8::1::2",
      "1:2:3:4:5:6:7:8:9",
      "12345::1",
      "[2001:db8::1",
      "[not-an-ip]:80",
      "::ffff:999.0.0.1",
      "%eth0",
    ]) {
      expect(normalizeAddress(junk), junk).toBe("unknown");
    }
  });

  it("ignores a port added by a proxy", () => {
    expect(normalizeAddress("203.0.113.7:5678")).toBe("203.0.113.7");
    expect(normalizeAddress(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(normalizeAddress("[2001:db8:1:2::1]:443")).toBe("2001:db8:1:2::/64");
    expect(normalizeAddress("[2001:db8:1:2::1]")).toBe("2001:db8:1:2::/64");
    expect(normalizeAddress("[::ffff:203.0.113.7]:80")).toBe("203.0.113.7");
  });
});

describe("client keys", () => {
  const keyOf = async (clientKey: ClientKey, headers: Record<string, string> = {}, socket?: string) => {
    const app = new Hono().get("/", (c) => c.text(clientKey(c)));
    const env = socket === undefined ? undefined : { incoming: { socket: { remoteAddress: socket } } };
    return (await app.request("/", { headers }, env)).text();
  };
  const xff = (value: string) => ({ "x-forwarded-for": value });

  it("falls back to a fixed key without a socket and ignores x-forwarded-for", async () => {
    expect(await keyOf(remoteAddress, xff("1.2.3.4"))).toBe("unknown");
  });

  it("normalises the socket address", async () => {
    expect(await keyOf(remoteAddress, {}, "::ffff:10.0.0.7")).toBe("10.0.0.7");
    expect(await keyOf(remoteAddress, {}, "2001:db8:1:2::abcd")).toBe("2001:db8:1:2::/64");
  });

  it("uses the entry appended by the one trusted proxy, not the client-supplied ones", async () => {
    const key = forwardedAddress(1);
    expect(await keyOf(key, xff("6.6.6.6, 10.0.0.7"))).toBe("10.0.0.7");
    expect(await keyOf(key, xff("6.6.6.6,2001:DB8:1:2::99"))).toBe("2001:db8:1:2::/64");
    expect(await keyOf(key, xff("2001:db8:1:2::1, ::ffff:203.0.113.7"))).toBe("203.0.113.7");
  });

  it("takes the N-th entry from the right behind N trusted proxies", async () => {
    expect(await keyOf(forwardedAddress(2), xff("6.6.6.6, 203.0.113.7, 10.0.0.1"))).toBe("203.0.113.7");
    expect(await keyOf(forwardedAddress(3), xff("6.6.6.6, 203.0.113.7, 10.0.0.1, 10.0.0.2"))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to the socket address when the proxies left no entry for the client", async () => {
    expect(await keyOf(forwardedAddress(1))).toBe("unknown");
    expect(await keyOf(forwardedAddress(1), {}, "::ffff:10.0.0.9")).toBe("10.0.0.9");
    expect(await keyOf(forwardedAddress(1), xff(""), "10.0.0.9")).toBe("10.0.0.9");
    expect(await keyOf(forwardedAddress(2), xff("203.0.113.7"), "10.0.0.9")).toBe("10.0.0.9");
  });

  it("uses the fixed key when the trusted entry is not an address", async () => {
    expect(await keyOf(forwardedAddress(1), xff("1.2.3.4, garbage"), "10.0.0.9")).toBe("unknown");
  });
});
