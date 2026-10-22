import {
  ADMIN_ORDERS_PAGE_SIZE,
  type CreateOrderInput,
  type Order,
  type OrderPage,
  orderPageSchema,
  orderSchema,
} from "@fapi/shared";
import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/shared/api/client";
import { ADMIN_ORDERS_KEY } from "@/shared/api/query-keys";

// The API allows an admin 120 requests a minute (defaultLimits.adminRequests in apps/api/src/config.ts),
// and a refresh refetches every loaded page at once, one request each. Refreshing by itself keeps to a
// quarter of that, leaving the rest to Load more and other admin tabs: twice a minute while that fits, once
// when only one refresh does, and never once a single refresh is bigger than the quarter (a longer interval
// would not shrink that burst); a long list gets a Refresh button instead. Polling also pauses while the
// tab is hidden (React Query's default).
const ADMIN_REQUESTS_PER_MINUTE = 120;
const REFRESH_REQUESTS_PER_MINUTE = ADMIN_REQUESTS_PER_MINUTE / 4;
const MAX_REFRESHES_PER_MINUTE = 2;
const MINUTE = 60_000;

/** How often to refresh the admin orders with `pages` pages loaded, or false for not by itself. */
export const adminOrdersRefreshMs = (pages: number): number | false => {
  const refreshes = Math.min(
    MAX_REFRESHES_PER_MINUTE,
    Math.floor(REFRESH_REQUESTS_PER_MINUTE / Math.max(pages, 1)),
  );
  return refreshes > 0 ? MINUTE / refreshes : false;
};

const refreshMsOf = (query: { state: { data?: InfiniteData<OrderPage, number> } }) =>
  adminOrdersRefreshMs(query.state.data?.pages.length ?? 0);

/** Drops every loaded admin page but the newest, so reloading the list is one request however long it got. */
const keepNewestAdminPage = (queryClient: QueryClient) =>
  queryClient.setQueryData<InfiniteData<OrderPage, number>>(
    ADMIN_ORDERS_KEY,
    (data) => data && { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) },
  );

/** `input.idempotencyKey` is one per checkout attempt: a retry returns the same order. */
export const useCreateOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrderInput) => api("/orders", orderSchema, { method: "POST", body: input }),
    // A new order makes the admin list stale: it starts over from the newest page, now if it is on
    // screen (the cart is on every page), else on the next visit. The checkout does not wait for it.
    onSuccess: () => {
      keepNewestAdminPage(queryClient);
      void queryClient.invalidateQueries({ queryKey: ADMIN_ORDERS_KEY });
    },
  });
};

export const useOrder = (id: string) =>
  useQuery({ queryKey: ["order", id], queryFn: () => api(`/orders/${id}`, orderSchema) });

export interface AdminOrders {
  orders: Order[];
  /** Number of orders in total, not just the loaded ones. */
  total: number;
  /** False once so many pages are loaded that only the admin refreshes them. */
  autoRefresh: boolean;
}

export const nextOrdersOffset = (last: OrderPage, pages: OrderPage[]) => {
  const loaded = pages.reduce((sum, p) => sum + p.items.length, 0);
  return loaded < last.total ? loaded : undefined;
};

/**
 * Newest orders come first, so one placed between two page loads shifts older ones down and
 * the next page repeats a row; show each order once. The next poll realigns the pages.
 */
export const toAdminOrders = (data: InfiniteData<OrderPage, number>): AdminOrders => {
  const byId = new Map(data.pages.flatMap((p) => p.items).map((o) => [o.id, o]));
  return {
    orders: [...byId.values()],
    total: data.pages.at(-1)?.total ?? byId.size,
    autoRefresh: adminOrdersRefreshMs(data.pages.length) !== false,
  };
};

/** `authorization` is a ready-made `Basic ...` header value; it is sent but kept out of the query key. */
export const adminOrdersOptions = (authorization: string) =>
  infiniteQueryOptions({
    queryKey: ADMIN_ORDERS_KEY,
    initialPageParam: 0,
    // Reading `signal` lets React Query stop a reload it cancels before it fetches the remaining pages.
    queryFn: ({ pageParam, signal }) =>
      api(`/admin/orders?limit=${ADMIN_ORDERS_PAGE_SIZE}&offset=${pageParam}`, orderPageSchema, {
        headers: { Authorization: authorization },
        signal,
      }),
    getNextPageParam: nextOrdersOffset,
    select: toAdminOrders,
    refetchInterval: refreshMsOf,
    // Focusing the tab, reconnecting and remounting refetch every page too: only once the data is
    // older than one interval, and never once polling stopped.
    staleTime: (query) => refreshMsOf(query) || Infinity,
    retry: false,
  });

/** Admin: one page of ADMIN_ORDERS_PAGE_SIZE at a time; `fetchNextPage` appends the next. */
export const useAdminOrders = (authorization: string) => useInfiniteQuery(adminOrdersOptions(authorization));

/** Starts over from the newest page: one request however many pages were loaded, and polling resumes. */
export const useRefreshAdminOrders = () => {
  const queryClient = useQueryClient();
  return useCallback(() => {
    keepNewestAdminPage(queryClient);
    return queryClient.refetchQueries({ queryKey: ADMIN_ORDERS_KEY });
  }, [queryClient]);
};
