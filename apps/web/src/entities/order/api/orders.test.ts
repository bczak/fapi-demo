import { ADMIN_ORDERS_PAGE_SIZE, type Order, type OrderPage } from "@fapi/shared";
import { type InfiniteData, QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { order as makeOrder } from "@/test/fixtures";
import { adminOrdersOptions, nextOrdersOffset, toAdminOrders } from "./orders";

const AUTH = "Basic YWRtaW46cGFzc3dvcmQ=";

const order = (n: number): Order => makeOrder(`order-${n}`);

const page = (from: number, count: number, total: number): OrderPage => ({
  items: Array.from({ length: count }, (_, i) => order(from + i)),
  total,
});

const infinite = (pages: OrderPage[]): InfiniteData<OrderPage, number> => ({
  pages,
  pageParams: pages.map((_, i) => i * ADMIN_ORDERS_PAGE_SIZE),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nextOrdersOffset", () => {
  it("continues after everything loaded so far while orders remain", () => {
    const first = page(0, 20, 45);
    const second = page(20, 20, 45);
    expect(nextOrdersOffset(second, [first, second])).toBe(40);
  });

  it("stops once every order is loaded", () => {
    const first = page(0, 20, 25);
    const second = page(20, 5, 25);
    expect(nextOrdersOffset(second, [first, second])).toBeUndefined();
  });
});

describe("toAdminOrders", () => {
  it("flattens the pages and reports the total from the latest one", () => {
    const result = toAdminOrders(infinite([page(0, 20, 25), page(20, 5, 26)]));
    expect(result.orders).toHaveLength(25);
    expect(result.total).toBe(26);
  });

  it("shows an order only once when a new order shifted the next page", () => {
    const result = toAdminOrders(infinite([page(0, 3, 6), page(2, 3, 6)]));
    expect(result.orders.map((o) => o.id)).toEqual(["order-0", "order-1", "order-2", "order-3", "order-4"]);
  });
});

describe("adminOrdersOptions", () => {
  const serve = (all: Order[]) =>
    vi.fn(async (url: string) => {
      const params = new URL(url, "http://localhost").searchParams;
      const offset = Number(params.get("offset"));
      const limit = Number(params.get("limit"));
      return Response.json({ items: all.slice(offset, offset + limit), total: all.length });
    });

  it("keeps the credential out of the query key and the cache", async () => {
    vi.stubGlobal("fetch", serve([order(0)]));
    const queryClient = new QueryClient();

    await queryClient.fetchInfiniteQuery(adminOrdersOptions(AUTH));

    expect(adminOrdersOptions(AUTH).queryKey).toEqual(["admin-orders"]);
    expect(adminOrdersOptions("Basic other").queryKey).toEqual(adminOrdersOptions(AUTH).queryKey);
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(JSON.stringify(keys)).not.toContain("Basic");
  });

  it("sends the credential as a header and pages by limit and offset", async () => {
    const fetchMock = serve(Array.from({ length: 25 }, (_, i) => order(i)));
    vi.stubGlobal("fetch", fetchMock);

    const data = await new QueryClient().fetchInfiniteQuery({ ...adminOrdersOptions(AUTH), pages: 2 });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/orders?limit=20&offset=0",
      expect.objectContaining({ headers: { Authorization: AUTH } }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/orders?limit=20&offset=20",
      expect.objectContaining({ headers: { Authorization: AUTH } }),
    );
    expect(data.pages.map((p) => p.items.length)).toEqual([20, 5]);
  });

  it("refreshes slowly: every poll refetches all loaded pages", () => {
    expect(adminOrdersOptions(AUTH).refetchInterval).toBeGreaterThanOrEqual(30_000);
  });
});
