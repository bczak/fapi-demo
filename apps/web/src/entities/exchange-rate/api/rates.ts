import { cnbRatesSchema } from "@fapi/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/shared/api/client";

/** Live ČNB rates (the API caches them for an hour, so a short client cache is enough). */
export const useRates = () =>
  useQuery({
    queryKey: ["rates"],
    queryFn: () => api("/rates", cnbRatesSchema),
    staleTime: 5 * 60 * 1000,
  });
