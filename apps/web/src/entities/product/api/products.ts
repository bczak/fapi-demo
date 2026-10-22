import { PRODUCTS_PAGE_SIZE, productPageSchema } from "@fapi/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/shared/api/client";

/** Products one page at a time; `fetchNextPage` appends the next PRODUCTS_PAGE_SIZE. */
export const useProducts = () =>
  useInfiniteQuery({
    queryKey: ["products"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api(`/products?limit=${PRODUCTS_PAGE_SIZE}&offset=${pageParam}`, productPageSchema),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, p) => sum + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
