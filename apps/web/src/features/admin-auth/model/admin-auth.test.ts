import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_ORDERS_KEY } from "@/shared/api/query-keys";
import { encodeBasicAuth } from "../lib/basic-auth";
import { signOut } from "./sign-out";
import { useAdminAuth } from "./store";

beforeEach(() => {
  useAdminAuth.setState({ authorization: null });
});

describe("useAdminAuth", () => {
  it("logs in with a UTF-8 encoded Basic header", () => {
    useAdminAuth.getState().login("admin", "příliš");
    expect(useAdminAuth.getState().authorization).toBe(encodeBasicAuth("admin", "příliš"));
  });

  it("keeps the credential in sessionStorage, not in localStorage", () => {
    useAdminAuth.getState().login("admin", "password");
    expect(sessionStorage.getItem("admin-auth")).toContain("Basic YWRtaW46cGFzc3dvcmQ=");
    expect(localStorage.length).toBe(0);
  });

  it("refuses a username with a colon", () => {
    expect(() => useAdminAuth.getState().login("ad:min", "password")).toThrow(RangeError);
    expect(useAdminAuth.getState().authorization).toBeNull();
  });

  it("clears the header on logout, in memory and in sessionStorage", () => {
    useAdminAuth.getState().login("admin", "password");
    useAdminAuth.getState().logout();
    expect(useAdminAuth.getState().authorization).toBeNull();
    expect(sessionStorage.getItem("admin-auth")).not.toContain("Basic");
  });
});

describe("signOut", () => {
  it("forgets the credential and drops every admin query from the cache", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(ADMIN_ORDERS_KEY, { pages: [], pageParams: [] });
    queryClient.setQueryData([...ADMIN_ORDERS_KEY, "detail"], "customer data");
    queryClient.setQueryData(["products"], "catalogue");
    useAdminAuth.getState().login("admin", "password");

    signOut(queryClient);

    expect(useAdminAuth.getState().authorization).toBeNull();
    expect(sessionStorage.getItem("admin-auth")).not.toContain("Basic");
    expect(queryClient.getQueryCache().findAll({ queryKey: ADMIN_ORDERS_KEY })).toHaveLength(0);
    expect(queryClient.getQueryData(["products"])).toBe("catalogue");
  });
});
