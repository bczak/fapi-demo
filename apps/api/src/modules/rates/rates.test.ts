import type { CnbRates } from "@fapi/shared";
import { describe, expect, it, vi } from "vitest";
import { setup } from "../../test-utils";
import { createRatesService } from "./rates.service";

const HEADER = "21.10.2026 #203\nzemě|měna|množství|kód|kurz\n";
const CNB_TEXT = `${HEADER}EMU|euro|1|EUR|24,330
USA|dolar|1|USD|21,593
`;
const TTL_MS = 10;
const BACKOFF_MS = 50;

const INFINITE_RATE_TEXT = CNB_TEXT.replace("24,330", "Infinity");
const ONLY_AUD_TEXT = `${HEADER}Austrálie|dolar|1|AUD|15,191\n`;
const INVALID_BODIES: Record<string, string> = {
  "an empty rate list": HEADER,
  "a non-finite rate": INFINITE_RATE_TEXT,
  "an overflowing rate": CNB_TEXT.replace("24,330", "1e999"),
  "a rate with trailing junk": CNB_TEXT.replace("24,330", "24,33abc"),
  "a zero amount": CNB_TEXT.replace("|1|EUR|", "|0|EUR|"),
  "an invalid currency code": CNB_TEXT.replace("EUR", "eur"),
  "a duplicate currency code": `${CNB_TEXT}Slovensko|euro|1|EUR|24,330\n`,
  "an impossible date": CNB_TEXT.replace("21.10.2026", "31.02.2026"),
  "an HTML page": "<html><body>Maintenance</body></html>",
  "none of the payment currencies": ONLY_AUD_TEXT,
  "a file without USD": CNB_TEXT.replace("USA|dolar|1|USD|21,593\n", ""),
};
const invalidCases = Object.entries(INVALID_BODIES);

function serviceWith(respond: () => Promise<Response>) {
  let t = 0;
  const fetchMock = vi.fn<typeof fetch>(respond);
  const warn = vi.fn<(message: string) => void>();
  const getRates = createRatesService({
    fetch: fetchMock,
    ttlMs: TTL_MS,
    backoffMs: BACKOFF_MS,
    now: () => t,
    warn,
  });
  const tick = (ms: number) => {
    t += ms;
  };
  return { getRates, fetchMock, warn, tick };
}

const serviceReturning = (body: () => string) => serviceWith(async () => new Response(body()));

/** A service whose ČNB answers with CNB_TEXT, or fails while `down` is set. */
function flakyService() {
  const state = { down: false, body: CNB_TEXT };
  const service = serviceWith(async () => {
    if (state.down) throw new Error("ECONNRESET");
    return new Response(state.body);
  });
  return { ...service, state };
}

describe("rates service", () => {
  it("parses and caches ČNB rates within the TTL", async () => {
    const { getRates, fetchMock, tick } = serviceReturning(() => CNB_TEXT);

    expect((await getRates()).rates[0]).toMatchObject({ code: "EUR", rate: 24.33 });
    tick(TTL_MS - 1);
    await getRates();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    tick(1);
    await getRates();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves stale rates when ČNB fails, throws if nothing cached", async () => {
    let fail = false;
    const { getRates, tick } = serviceWith(async () =>
      fail ? new Response("", { status: 500 }) : new Response(CNB_TEXT),
    );

    fail = true;
    await expect(getRates()).rejects.toThrow();

    fail = false;
    const first = await getRates();
    fail = true;
    tick(100);
    expect(await getRates()).toEqual(first);
  });

  it.each(invalidCases)(
    "keeps serving the cached rates when ČNB returns %s, then recovers",
    async (_, invalid) => {
      let body = CNB_TEXT;
      const { getRates, fetchMock, tick } = serviceReturning(() => body);
      const first = await getRates();

      body = invalid;
      tick(TTL_MS);
      expect(await getRates()).toEqual(first);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      body = CNB_TEXT.replace("24,330", "25,000");
      tick(BACKOFF_MS);
      expect((await getRates()).rates[0]).toMatchObject({ code: "EUR", rate: 25 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it.each(invalidCases)("throws when ČNB returns %s and nothing is cached", async (_, invalid) => {
    let body = invalid;
    const { getRates } = serviceReturning(() => body);
    await expect(getRates()).rejects.toThrow();

    body = CNB_TEXT;
    expect((await getRates()).rates[0]).toMatchObject({ code: "EUR", rate: 24.33 });
  });

  it("names the payment currencies missing from a well-formed ČNB file", async () => {
    const { getRates } = serviceReturning(() => ONLY_AUD_TEXT);
    await expect(getRates()).rejects.toThrow("ČNB rates are missing EUR, USD");
  });

  it("shares one ČNB request between concurrent callers", async () => {
    const { getRates, fetchMock, tick } = serviceReturning(() => CNB_TEXT);

    const [first, ...others] = await Promise.all([getRates(), getRates(), getRates()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(others).toEqual([first, first]);

    tick(TTL_MS);
    await Promise.all([getRates(), getRates(), getRates()]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one failing request between concurrent callers and retries on the next call", async () => {
    const { getRates, fetchMock, state } = flakyService();
    state.down = true;

    const results = await Promise.allSettled([getRates(), getRates(), getRates()]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    state.down = false;
    expect((await getRates()).rates[0]).toMatchObject({ code: "EUR" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves ČNB alone for the backoff after a failed refresh, then retries and recovers", async () => {
    const { getRates, fetchMock, tick, state } = flakyService();
    const first = await getRates();

    state.down = true;
    tick(TTL_MS);
    expect(await getRates()).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    tick(BACKOFF_MS - 1);
    expect(await getRates()).toEqual(first);
    expect(await getRates()).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    tick(1);
    expect(await getRates()).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    state.down = false;
    state.body = CNB_TEXT.replace("24,330", "25,000");
    tick(BACKOFF_MS);
    expect((await getRates()).rates[0]).toMatchObject({ code: "EUR", rate: 25 });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    tick(TTL_MS - 1);
    expect((await getRates()).rates[0]).toMatchObject({ code: "EUR", rate: 25 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("logs one line without a stack when concurrent callers get stale rates", async () => {
    const { getRates, fetchMock, warn, tick, state } = flakyService();
    await getRates();

    state.down = true;
    tick(TTL_MS);
    await Promise.all([getRates(), getRates(), getRates()]);
    await getRates();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls).toEqual([
      ["ČNB rates refresh failed (ECONNRESET), serving rates from 2026-10-21"],
    ]);
  });
});

describe("GET /api/rates", () => {
  it("returns rates", async () => {
    const { app } = setup();
    const body = (await (await app.request("/api/rates")).json()) as CnbRates;
    expect(body.rates[0]?.code).toBe("EUR");
  });

  it("answers 502 when rates are unavailable", async () => {
    const { app } = setup(async () => {
      throw new Error("down");
    });
    expect((await app.request("/api/rates")).status).toBe(502);
  });

  it.each([
    ["invalid", INFINITE_RATE_TEXT],
    ["missing the payment currencies", ONLY_AUD_TEXT],
  ])("answers 502 when the only response from ČNB is %s", async (_, body) => {
    const { getRates } = serviceReturning(() => body);
    const { app } = setup(getRates);
    expect((await app.request("/api/rates")).status).toBe(502);
  });
});
