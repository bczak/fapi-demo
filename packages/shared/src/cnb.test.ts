import { describe, expect, it } from "vitest";
import { parseCnbRates } from "./cnb";

const HEADER = "21.10.2026 #203\nzemě|měna|množství|kód|kurz";
const SAMPLE = `${HEADER}
Austrálie|dolar|1|AUD|15,191
Maďarsko|forint|100|HUF|6,201
EMU|euro|1|EUR|24,330
`;

const withRows = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("parseCnbRates", () => {
  it("parses date and rows, handling decimal commas", () => {
    const parsed = parseCnbRates(SAMPLE);
    expect(parsed.date).toBe("2026-10-21");
    expect(parsed.rates).toHaveLength(3);
    expect(parsed.rates[1]).toEqual({
      country: "Maďarsko",
      currency: "forint",
      code: "HUF",
      amount: 100,
      rate: 6.201,
    });
  });

  it("accepts CRLF line endings and whole-number rates", () => {
    const parsed = parseCnbRates(SAMPLE.replace(/\n/g, "\r\n").replace("15,191", "15"));
    expect(parsed.rates).toHaveLength(3);
    expect(parsed.rates[0]?.rate).toBe(15);
  });

  it("throws on malformed input", () => {
    expect(() => parseCnbRates("garbage")).toThrow();
    expect(() => parseCnbRates("21.10.2026 #1\nheader\nfoo|bar")).toThrow();
  });

  it("rejects a header without any currency rows", () => {
    expect(() => parseCnbRates(HEADER)).toThrow(/no rates/);
    expect(() => parseCnbRates("21.10.2026 #203")).toThrow();
    expect(() => parseCnbRates("")).toThrow();
  });

  it.each([
    ["31.02.2026 #1", "a day the month does not have"],
    ["21.13.2026 #1", "a month above 12"],
    ["00.10.2026 #1", "day zero"],
    ["29.02.2025 #1", "a leap day in a non-leap year"],
    ["2026-10-21 #1", "a non-ČNB date format"],
  ])("rejects an invalid header date %s (%s)", (head) => {
    expect(() => parseCnbRates(`${head}\nheader\nEMU|euro|1|EUR|24,330`)).toThrow();
  });

  it("accepts a leap day in a leap year", () => {
    expect(parseCnbRates("29.02.2028 #1\nheader\nEMU|euro|1|EUR|24,330").date).toBe("2028-02-29");
  });

  it.each([
    ["Infinity", "EMU|euro|1|EUR|Infinity"],
    ["NaN", "EMU|euro|1|EUR|NaN"],
    ["exponent overflow", "EMU|euro|1|EUR|1e999"],
    ["digit overflow", `EMU|euro|1|EUR|${"9".repeat(400)}`],
    ["trailing junk", "EMU|euro|1|EUR|24,33abc"],
    ["two decimal commas", "EMU|euro|1|EUR|24,33,0"],
    ["a dot decimal separator", "EMU|euro|1|EUR|24.330"],
    ["a thousands separator", "EMU|euro|1|EUR|1 024,33"],
    ["a trailing comma", "EMU|euro|1|EUR|24,"],
    ["a leading comma", "EMU|euro|1|EUR|,33"],
    ["a hex value", "EMU|euro|1|EUR|0x10"],
    ["a negative value", "EMU|euro|1|EUR|-24,33"],
    ["a zero value", "EMU|euro|1|EUR|0,000"],
    ["an empty value", "EMU|euro|1|EUR|"],
  ])("rejects a rate with %s", (_, row) => {
    expect(() => parseCnbRates(withRows(row))).toThrow();
  });

  it.each([
    ["zero", "EMU|euro|0|EUR|24,330"],
    ["negative", "EMU|euro|-1|EUR|24,330"],
    ["fractional", "EMU|euro|1,5|EUR|24,330"],
    ["a dotted fraction", "EMU|euro|1.5|EUR|24,330"],
    ["Infinity", "EMU|euro|Infinity|EUR|24,330"],
    ["exponent notation", "EMU|euro|1e2|EUR|24,330"],
    ["trailing junk", "EMU|euro|100x|EUR|24,330"],
    ["beyond the safe integer range", `EMU|euro|${"9".repeat(20)}|EUR|24,330`],
    ["empty", "EMU|euro||EUR|24,330"],
  ])("rejects an amount that is %s", (_, row) => {
    expect(() => parseCnbRates(withRows(row))).toThrow();
  });

  it.each([
    ["lowercase", "EMU|euro|1|eur|24,330"],
    ["too short", "EMU|euro|1|EU|24,330"],
    ["too long", "EMU|euro|1|EURO|24,330"],
    ["containing a digit", "EMU|euro|1|EU1|24,330"],
    ["padded with whitespace", "EMU|euro|1| EUR|24,330"],
    ["empty", "EMU|euro|1||24,330"],
  ])("rejects a currency code that is %s", (_, row) => {
    expect(() => parseCnbRates(withRows(row))).toThrow();
  });

  it.each([
    ["missing country", "|euro|1|EUR|24,330"],
    ["missing currency name", "EMU||1|EUR|24,330"],
    ["too few fields", "EMU|euro|1|EUR"],
    ["too many fields", "EMU|euro|1|EUR|24,330|extra"],
    ["a blank line between rows", "\nEMU|euro|1|EUR|24,330"],
  ])("rejects a row with %s", (_, row) => {
    expect(() => parseCnbRates(withRows("Austrálie|dolar|1|AUD|15,191", row))).toThrow();
  });

  it("rejects duplicate currency codes", () => {
    expect(() => parseCnbRates(withRows("EMU|euro|1|EUR|24,330", "Slovensko|euro|1|EUR|24,330"))).toThrow(
      /duplicate/,
    );
  });

  it("rejects the whole file when a single row is invalid", () => {
    expect(() => parseCnbRates(withRows("EMU|euro|1|EUR|24,330", "USA|dolar|1|USD|Infinity"))).toThrow();
  });
});
