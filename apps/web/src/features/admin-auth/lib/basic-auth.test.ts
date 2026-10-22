import { describe, expect, it } from "vitest";
import { encodeBasicAuth, isBasicUser } from "./basic-auth";

/** What the server does: base64 -> bytes -> strict UTF-8 -> split at the first ":". */
function decode(header: string) {
  const bytes = Uint8Array.from(atob(header.replace(/^Basic /, "")), (c) => c.charCodeAt(0));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const sep = text.indexOf(":");
  return { user: text.slice(0, sep), password: text.slice(sep + 1) };
}

describe("encodeBasicAuth", () => {
  it("encodes ASCII credentials like btoa", () => {
    expect(encodeBasicAuth("admin", "password")).toBe("Basic YWRtaW46cGFzc3dvcmQ=");
  });

  it("encodes characters btoa rejects instead of throwing", () => {
    expect(() => btoa("admin:příliš")).toThrow();
    expect(decode(encodeBasicAuth("admin", "příliš"))).toEqual({ user: "admin", password: "příliš" });
  });

  it("sends Latin-1 characters as UTF-8, not as one byte", () => {
    expect(encodeBasicAuth("u", "café")).toBe("Basic dTpjYWbDqQ==");
    expect(encodeBasicAuth("u", "café")).not.toBe(`Basic ${btoa("u:café")}`);
  });

  it("round-trips non-ASCII usernames and characters outside the BMP", () => {
    expect(decode(encodeBasicAuth("jiří", "pass😀word"))).toEqual({ user: "jiří", password: "pass😀word" });
  });

  it("allows ':' in the password, the server splits at the first one", () => {
    expect(decode(encodeBasicAuth("admin", "a:b:c"))).toEqual({ user: "admin", password: "a:b:c" });
  });

  it("rejects ':' in the username (RFC 7617)", () => {
    expect(() => encodeBasicAuth("ad:min", "password")).toThrow(RangeError);
  });
});

describe("isBasicUser", () => {
  it.each([
    ["admin", true],
    ["jiří", true],
    ["ad:min", false],
    [":", false],
  ])("%s -> %s", (user, expected) => {
    expect(isBasicUser(user)).toBe(expected);
  });
});
