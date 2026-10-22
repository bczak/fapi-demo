import type { Product, ProductPage } from "@fapi/shared";
import { describe, expect, it } from "vitest";
import { setup } from "../../test-utils";

const get = async (path: string) => {
  const { app } = setup();
  const res = await app.request(path);
  return { status: res.status, body: await res.json() };
};

describe("GET /api/products", () => {
  it("returns the first 12 products and the catalogue size by default", async () => {
    const { status, body } = await get("/api/products");
    const page = body as ProductPage;
    expect(status).toBe(200);
    expect(page.items).toHaveLength(12);
    expect(page.total).toBe(50);
  });

  it("pages with limit and offset without overlap", async () => {
    const first = (await get("/api/products?limit=12&offset=0")).body as ProductPage;
    const second = (await get("/api/products?limit=12&offset=12")).body as ProductPage;
    const ids = (page: ProductPage) => page.items.map((p) => p.id);
    expect(ids(first)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(ids(second)).toEqual(Array.from({ length: 12 }, (_, i) => i + 13));
  });

  it("returns a short last page", async () => {
    const page = (await get("/api/products?limit=12&offset=48")).body as ProductPage;
    expect(page.items).toHaveLength(2);
  });

  it("rejects an invalid limit", async () => {
    expect((await get("/api/products?limit=0")).status).toBe(422);
    expect((await get("/api/products?limit=1000")).status).toBe(422);
  });

  it("serves a product with its image", async () => {
    const { status, body } = await get("/api/products/1");
    expect(status).toBe(200);
    expect((body as Product).imageUrl).toMatch(/^https:\/\/picsum\.photos\/seed\/.+\/800\/600$/);
  });
});
