import { cnbRatesSchema } from "@fapi/shared";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api/client";

/**
 * Live ČNB rates (the API caches them for an hour, so a short client cache is enough).
 * The request takes no abort signal on purpose: a prefetch must survive the payment step mounting and
 * unmounting (going Back, or React's development double mount) instead of being cancelled and repeated.
 */
const ratesOptions = queryOptions({
  queryKey: ["rates"],
  queryFn: () => api("/rates", cnbRatesSchema),
  staleTime: 5 * 60 * 1000,
});

export const useRates = () => useQuery(ratesOptions);

/** Starts loading the rates ahead of time (e.g. when the cart opens), so the payment step has them ready. */
export function usePrefetchRates() {
  const queryClient = useQueryClient();
  return () => void queryClient.prefetchQuery(ratesOptions);
}
