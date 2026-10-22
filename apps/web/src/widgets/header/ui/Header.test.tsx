import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminAuth } from "@/features/admin-auth";
import { ADMIN_ORDERS_KEY } from "@/shared/api/query-keys";
import { renderWithClient } from "@/test/render";
import { Header } from "./Header";

const AUTH = "Basic YWRtaW46cGFzc3dvcmQ=";

/** The header above an empty page at `path`, in a router of its own. */
async function renderAt(path: string) {
  const rootRoute = createRootRoute({ component: () => <Header /> });
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/admin" }),
  ]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  const view = renderWithClient(<RouterProvider router={router} />);
  await screen.findByRole("link", { name: "FAPI Shop" });
  return view;
}

const adminLink = () => screen.queryByRole("link", { name: "Admin" });
const signOutButton = () => screen.queryByRole("button", { name: "Sign out" });

beforeEach(() => {
  useAdminAuth.setState({ authorization: null });
  // The router restores the scroll position on navigation, which jsdom does not implement.
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("Header", () => {
  it.each(["/", "/admin"])("links to the admin while signed out (%s)", async (path) => {
    await renderAt(path);

    expect(adminLink()).toHaveAttribute("href", "/admin");
    expect(signOutButton()).not.toBeInTheDocument();
  });

  it("shows only Sign out on the admin page while signed in", async () => {
    useAdminAuth.setState({ authorization: AUTH });
    await renderAt("/admin");

    expect(signOutButton()).toBeInTheDocument();
    expect(adminLink()).not.toBeInTheDocument();
  });

  it("shows the admin link and Sign out on the shop while signed in", async () => {
    useAdminAuth.setState({ authorization: AUTH });
    const { user } = await renderAt("/");

    expect(adminLink()).toBeInTheDocument();
    expect(signOutButton()).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Admin" }));
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(adminLink()).not.toBeInTheDocument();
  });

  it("signs out from the shop: forgets the credential and the cached admin orders", async () => {
    useAdminAuth.setState({ authorization: AUTH });
    const { user, queryClient } = await renderAt("/");
    queryClient.setQueryData(ADMIN_ORDERS_KEY, { pages: [], pageParams: [] });
    queryClient.setQueryData(["products"], "catalogue");

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(useAdminAuth.getState().authorization).toBeNull();
    expect(sessionStorage.getItem("admin-auth")).not.toContain("Basic");
    expect(queryClient.getQueryCache().findAll({ queryKey: ADMIN_ORDERS_KEY })).toHaveLength(0);
    expect(queryClient.getQueryData(["products"])).toBe("catalogue");
    expect(signOutButton()).not.toBeInTheDocument();
    expect(adminLink()).toBeInTheDocument();
  });
});
