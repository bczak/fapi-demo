import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { ADMIN_ORDERS_KEY } from "@/shared/api/query-keys";
import { useAdminAuth } from "./store";

/** Forgets the credential and drops every cached admin response (it holds customer data). */
export function signOut(queryClient: QueryClient) {
  useAdminAuth.getState().logout();
  queryClient.removeQueries({ queryKey: ADMIN_ORDERS_KEY });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useCallback(() => signOut(queryClient), [queryClient]);
}
