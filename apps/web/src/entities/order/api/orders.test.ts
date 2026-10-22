import { ADMIN_ORDERS_PAGE_SIZE, type CreateOrderInput, type Order, type OrderPage } from "@fapi/shared";
import {
  type InfiniteData,
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ORDERS_KEY } from "@/shared/api/query-keys";
import { deferred } from "@/test/fetch";
import { customer, order as makeOrder } from "@/test/fixtures";
import {
  adminOrdersOptions,
  adminOrdersRefreshMs,
  nextOrdersOffset,
  toAdminOrders,
  useAdminOrders,
  useCreateOrder,
} from "./orders";

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

const serve = (all: Order[]) =>
  vi.fn(async (url: string) => {
    const params = new URL(url, "http://localhost").searchParams;
    const offset = Number(params.get("offset"));
    const limit = Number(params.get("limit"));
    return Response.json({ items: all.slice(offset, offset + limit), total: all.length });
  });

describe("adminOrdersOptions", () => {
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
});

describe("adminOrdersRefreshMs", () => {
  it.each([
    [1, 30_000],
    [10, 30_000],
    [15, 30_000],
    [16, 60_000],
    [30, 60_000],
    [31, false],
    [61, false],
    [200, false],
  ])("with %i pages loaded: %s", (pages, ms) => {
    expect(adminOrdersRefreshMs(pages)).toBe(ms);
  });

  it("tells the list whether it still refreshes by itself", () => {
    const pages = (count: number) => Array.from({ length: count }, (_, i) => page(i, 1, 100));
    expect(toAdminOrders(infinite(pages(30))).autoRefresh).toBe(true);
    expect(toAdminOrders(infinite(pages(31))).autoRefresh).toBe(false);
  });
});

describe("admin orders refreshing by itself", () => {
  const MINUTE = 60_000;
  // The API's limit for an admin (defaultLimits.adminRequests in apps/api/src/config.ts).
  const ADMIN_REQUESTS_PER_MINUTE = 120;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The most requests sent within any one minute, wherever the API's window starts. */
  const busiestMinute = (times: number[]) =>
    Math.max(0, ...times.map((start) => times.filter((t) => t >= start && t < start + MINUTE).length));

  /** When each request is sent while the admin page (mounted again) shows `pages` loaded pages for ten minutes. */
  async function requestTimes(pages: number, { switchingTabs = false } = {}) {
    const times: number[] = [];
    const respond = serve(Array.from({ length: pages * ADMIN_ORDERS_PAGE_SIZE + 1 }, (_, i) => order(i)));
    vi.stubGlobal("fetch", (url: string) => {
      times.push(Date.now());
      return respond(url);
    });
    const queryClient = new QueryClient();
    queryClient.mount();
    await queryClient.fetchInfiniteQuery({ ...adminOrdersOptions(AUTH), pages });
    times.length = 0;

    const unsubscribe = new InfiniteQueryObserver(queryClient, adminOrdersOptions(AUTH)).subscribe(() => {});
    for (let elapsed = 0; elapsed < 10 * MINUTE; elapsed += 10_000) {
      // The admin comes back to the tab every ten seconds.
      if (switchingTabs) window.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(10_000);
    }
    unsubscribe();
    queryClient.unmount();
    return times;
  }

  it.each([
    [1, 2],
    [10, 20],
    [15, 30],
    [16, 16],
    [30, 30],
    [31, 0],
    [61, 0],
    [200, 0],
  ])("with %i pages loaded polls with %i requests in the busiest minute", async (pages, requests) => {
    const busiest = busiestMinute(await requestTimes(pages));

    expect(busiest).toBe(requests);
    expect(busiest).toBeLessThanOrEqual(ADMIN_REQUESTS_PER_MINUTE / 4);
  });

  it.each([
    [1, 2],
    [15, 30],
    [31, 0],
  ])(
    "with %i pages loaded, coming back to the tab adds no requests (%i in the busiest minute)",
    async (pages, requests) => {
      expect(busiestMinute(await requestTimes(pages, { switchingTabs: true }))).toBe(requests);
    },
  );
});

describe("useCreateOrder", () => {
  // As if Load more had been pressed 69 times: reloading every loaded page would be 70 requests at once.
  const LOADED_PAGES = 70;
  const older = Array.from({ length: LOADED_PAGES * ADMIN_ORDERS_PAGE_SIZE }, (_, i) => order(i));
  const placed = makeOrder("placed");
  const input: CreateOrderInput = {
    idempotencyKey: "0b6f7c3e-5a1d-4f2b-9c8e-7d6a5b4c3d2e",
    customer,
    items: [{ productId: 1, quantity: 2 }],
    currency: "CZK",
  };
  const newestPage = `/api/admin/orders?limit=${ADMIN_ORDERS_PAGE_SIZE}&offset=0`;

  /** A cache with LOADED_PAGES admin pages; `answerAdmin` answers the admin requests, recorded in order. */
  function setup(answerAdmin: (url: string) => Promise<Response>) {
    const adminRequests: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (init.method === "POST") return Response.json(placed);
      adminRequests.push(url);
      return answerAdmin(url);
    });
    const queryClient = new QueryClient();
    const pages = Array.from({ length: LOADED_PAGES }, (_, i) =>
      page(i * ADMIN_ORDERS_PAGE_SIZE, ADMIN_ORDERS_PAGE_SIZE, older.length),
    );
    queryClient.setQueryData(ADMIN_ORDERS_KEY, infinite(pages));
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    return { adminRequests, wrapper };
  }

  /** The admin page with the cart, which is on every page. */
  const adminPageWithCart = () => ({ admin: useAdminOrders(AUTH), createOrder: useCreateOrder() });

  it("reloads only the newest page of the admin list on screen, however many were loaded", async () => {
    const { adminRequests, wrapper } = setup(serve([placed, ...older]));
    const { result } = renderHook(adminPageWithCart, { wrapper });

    await act(() => result.current.createOrder.mutateAsync(input));

    await waitFor(() => expect(result.current.admin.data?.orders[0]).toEqual(placed));
    expect(result.current.admin.data?.orders).toHaveLength(ADMIN_ORDERS_PAGE_SIZE);
    expect(adminRequests).toEqual([newestPage]);
  });

  it("does not keep the checkout waiting for the admin list to reload", async () => {
    // The admin request never answers.
    const { adminRequests, wrapper } = setup(() => new Promise(() => {}));
    const { result } = renderHook(adminPageWithCart, { wrapper });
    const onPlaced = vi.fn();

    act(() => {
      void result.current.createOrder.mutateAsync(input).then(onPlaced);
    });

    await waitFor(() => expect(onPlaced).toHaveBeenCalledWith(placed));
    expect(adminRequests).toEqual([newestPage]);
  });

  it("stops a reload of every page that was under way when the order was placed", async () => {
    const lateFirstPage = deferred<Response>();
    const answer = serve([placed, ...older]);
    let calls = 0;
    const { adminRequests, wrapper } = setup((url) => (calls++ === 0 ? lateFirstPage.promise : answer(url)));
    const { result } = renderHook(adminPageWithCart, { wrapper });
    // A reload of all the loaded pages starts (as a poll does); its first request hangs.
    act(() => {
      void result.current.admin.refetch();
    });
    await waitFor(() => expect(adminRequests).toHaveLength(1));

    await act(() => result.current.createOrder.mutateAsync(input));
    await act(async () => {
      lateFirstPage.resolve(Response.json(page(0, ADMIN_ORDERS_PAGE_SIZE, older.length)));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(result.current.admin.data?.orders[0]).toEqual(placed));
    // The cancelled reload asks for none of its other 69 pages.
    expect(adminRequests).toEqual([newestPage, newestPage]);
  });

  it("cuts the admin list off screen to its newest page, reloaded on the next visit", async () => {
    const { adminRequests, wrapper } = setup(serve([placed, ...older]));
    const cart = renderHook(useCreateOrder, { wrapper });

    await act(() => cart.result.current.mutateAsync(input));
    expect(adminRequests).toEqual([]);

    const { result } = renderHook(() => useAdminOrders(AUTH), { wrapper });

    await waitFor(() => expect(result.current.data?.orders[0]).toEqual(placed));
    expect(result.current.data?.orders).toHaveLength(ADMIN_ORDERS_PAGE_SIZE);
    expect(adminRequests).toEqual([newestPage]);
  });
});
