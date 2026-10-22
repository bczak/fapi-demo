import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createDb } from "./db/client";
import { seedProducts } from "./db/seed";
import { ADMIN, SAMPLE_RATES } from "./test-utils";

const webDist = mkdtempSync(join(tmpdir(), "fapi-web-"));
mkdirSync(join(webDist, "assets"));
writeFileSync(join(webDist, "index.html"), "<!doctype html><title>shell</title>");
writeFileSync(join(webDist, "assets", "app-abc123.js"), "console.log(1)");
afterAll(() => rmSync(webDist, { recursive: true, force: true }));

function serving() {
  const db = createDb(":memory:");
  seedProducts(db);
  return createApp({ db, getRates: async () => SAMPLE_RATES, admin: ADMIN, webDist });
}

describe("serving the built web app (production)", () => {
  it("serves the app shell at / without caching it", async () => {
    const res = await serving().request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(await res.text()).toContain("shell");
  });

  it("serves hashed assets with a long cache lifetime", async () => {
    const res = await serving().request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("javascript");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
  });

  it("falls back to the shell for client-side routes", async () => {
    const app = serving();
    for (const path of ["/admin", "/thank-you/3f6c8a52-5b0e-4c43-9a43-1f2b6d3a9c11"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("shell");
    }
  });

  it("keeps the API answering, and unknown API paths as JSON 404s", async () => {
    const app = serving();
    expect(await (await app.request("/api/health")).json()).toEqual({ status: "ok" });
    const missing = await app.request("/api/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ message: "Not found" });
  });

  it("does not serve files outside the build directory", async () => {
    const res = await serving().request("/..%2Fpackage.json");
    expect(await res.text()).not.toContain('"name"');
  });
});
