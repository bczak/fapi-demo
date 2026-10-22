import type { ApiErrorBody, Product, ProductPage } from "@fapi/shared";
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

describe("GET /api/products?ids", () => {
  const ids = (page: ProductPage) => page.items.map((p) => p.id);

  it("returns the requested products in id order, with the catalogue size", async () => {
    const { status, body } = await get("/api/products?ids=12,3,7");
    const page = body as ProductPage;
    expect(status).toBe(200);
    expect(ids(page)).toEqual([3, 7, 12]);
    expect(page.items[0]).toEqual((await get("/api/products/3")).body);
    expect(page.total).toBe(50);
  });

  it("leaves out ids that do not exist", async () => {
    const page = (await get("/api/products?ids=999,2,51")).body as ProductPage;
    expect(ids(page)).toEqual([2]);
    expect(((await get("/api/products?ids=999")).body as ProductPage).items).toEqual([]);
  });

  it("lists a repeated id once", async () => {
    expect(ids((await get("/api/products?ids=4,4")).body as ProductPage)).toEqual([4]);
  });

  it("is not cut by limit and offset", async () => {
    const page = (await get("/api/products?ids=1,2,3&limit=1&offset=10")).body as ProductPage;
    expect(ids(page)).toEqual([1, 2, 3]);
  });

  it("takes up to 50 ids", async () => {
    const all = Array.from({ length: 50 }, (_, i) => i + 1);
    expect(ids((await get(`/api/products?ids=${all.join(",")}`)).body as ProductPage)).toEqual(all);
  });

  it.each([
    ["an empty list", "ids="],
    ["a word", "ids=abc"],
    ["an empty item", "ids=1,,2"],
    ["a trailing comma", "ids=1,"],
    ["a space", "ids=1,%202"],
    ["zero", "ids=0"],
    ["a negative id", "ids=-1"],
    ["a fraction", "ids=1.5"],
    ["an id beyond the safe integers", "ids=9007199254740993"],
    ["51 ids", `ids=${Array.from({ length: 51 }, (_, i) => i + 1).join(",")}`],
    ["the parameter twice", "ids=1&ids=2"],
  ])("rejects %s with 422", async (_, query) => {
    const { status, body } = await get(`/api/products?${query}`);
    expect(status).toBe(422);
    expect((body as ApiErrorBody).issues?.[0]?.path).toMatch(/^ids/);
  });
});
