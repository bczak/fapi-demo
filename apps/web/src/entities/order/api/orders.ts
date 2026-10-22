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
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/shared/api/client";
import { ADMIN_ORDERS_KEY } from "@/shared/api/query-keys";

// Each poll refetches every page loaded so far, one after another, so a short interval gets
// costly as the admin pages deeper. 30 s still shows new orders without a button; it also
// pauses while the tab is hidden (React Query's default).
const ADMIN_ORDERS_REFRESH_MS = 30_000;

/** `input.idempotencyKey` is one per checkout attempt: a retry returns the same order. */
export const useCreateOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrderInput) => api("/orders", orderSchema, { method: "POST", body: input }),
    // A new order makes the admin list stale.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_ORDERS_KEY }),
  });
};

export const useOrder = (id: string) =>
  useQuery({ queryKey: ["order", id], queryFn: () => api(`/orders/${id}`, orderSchema) });

export interface AdminOrders {
  orders: Order[];
  /** Number of orders in total, not just the loaded ones. */
  total: number;
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
  return { orders: [...byId.values()], total: data.pages.at(-1)?.total ?? byId.size };
};

/** `authorization` is a ready-made `Basic ...` header value; it is sent but kept out of the query key. */
export const adminOrdersOptions = (authorization: string) =>
  infiniteQueryOptions({
    queryKey: ADMIN_ORDERS_KEY,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api(`/admin/orders?limit=${ADMIN_ORDERS_PAGE_SIZE}&offset=${pageParam}`, orderPageSchema, {
        headers: { Authorization: authorization },
      }),
    getNextPageParam: nextOrdersOffset,
    select: toAdminOrders,
    refetchInterval: ADMIN_ORDERS_REFRESH_MS,
    retry: false,
  });

/** Admin: one page of ADMIN_ORDERS_PAGE_SIZE at a time; `fetchNextPage` appends the next. */
export const useAdminOrders = (authorization: string) => useInfiniteQuery(adminOrdersOptions(authorization));
