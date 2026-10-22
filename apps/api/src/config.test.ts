import { describe, expect, it } from "vitest";
import { parseTrustProxy } from "./config";

describe("parseTrustProxy", () => {
  it('reads "true" as one trusted proxy and a number as that many', () => {
    expect(parseTrustProxy("true")).toBe(1);
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("3")).toBe(3);
  });

  it("ignores case and surrounding spaces", () => {
    expect(parseTrustProxy("TRUE")).toBe(1);
    expect(parseTrustProxy(" True ")).toBe(1);
    expect(parseTrustProxy(" 2")).toBe(2);
  });

  it("trusts no proxy when unset, false, zero or anything else", () => {
    for (const value of [undefined, "", "false", "0", "yes", "-1", "1.5", "2x"]) {
      expect(parseTrustProxy(value), String(value)).toBe(0);
    }
  });
});
