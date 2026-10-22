import { ADMIN_ORDERS_PAGE_SIZE } from "@fapi/shared";
import { screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAdminAuth } from "@/features/admin-auth";
import { ADMIN_ORDERS_KEY } from "@/shared/api/query-keys";
import { stubFetch } from "@/test/fetch";
import { order } from "@/test/fixtures";
import { renderWithClient } from "@/test/render";
import { AdminPage } from "./AdminPage";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const AUTH = "Basic YWRtaW46cGFzc3dvcmQ=";
const ORDER_COUNT = ADMIN_ORDERS_PAGE_SIZE + 5;
const allOrders = Array.from({ length: ORDER_COUNT }, (_, i) => order(`order-${i}`));

const servePage = (url: URL) => {
  const offset = Number(url.searchParams.get("offset"));
  return Response.json({
    items: allOrders.slice(offset, offset + ADMIN_ORDERS_PAGE_SIZE),
    total: ORDER_COUNT,
  });
};
const tooManyRequests = () => Response.json({ message: "Too many requests" }, { status: 429 });

function setup(...responses: Array<(url: URL) => Response>) {
  const route = vi.fn<(url: URL) => Response>(servePage);
  for (const response of responses) route.mockImplementationOnce(response);
  const fetchMock = stubFetch({ "GET /api/admin/orders": route });
  return { fetchMock, ...renderWithClient(<AdminPage />) };
}

const showing = (shown: number) => screen.findByText(`Showing ${shown} of ${ORDER_COUNT} orders`);

beforeEach(() => {
  useAdminAuth.setState({ authorization: AUTH });
});

describe("AdminPage", () => {
  it("shows the login form while signed out and does not ask for orders", () => {
    useAdminAuth.setState({ authorization: null });
    const { fetchMock } = setup();

    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the credential as a header only, and pages the orders with Load more", async () => {
    const { user, fetchMock, queryClient } = setup();

    expect(await showing(ADMIN_ORDERS_PAGE_SIZE)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/orders?limit=${ADMIN_ORDERS_PAGE_SIZE}&offset=0`,
      expect.objectContaining({ headers: { Authorization: AUTH } }),
    );

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await showing(ORDER_COUNT)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^View order/ })).toHaveLength(ORDER_COUNT);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey);
    expect(keys).toEqual([ADMIN_ORDERS_KEY]);
    expect(JSON.stringify(keys)).not.toContain("Basic");
  });

  it("signs out, forgets the cached orders and says why when the credentials are rejected (401)", async () => {
    const { queryClient } = setup(() => Response.json({ message: "Unauthorized" }, { status: 401 }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Invalid credentials"));
    await waitFor(() => expect(useAdminAuth.getState().authorization).toBeNull());
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(queryClient.getQueryCache().findAll({ queryKey: ADMIN_ORDERS_KEY })).toHaveLength(0);
  });

  it("signs out when the lockout (429) hits before any order has loaded", async () => {
    setup(tooManyRequests);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Too many attempts, try again later"));
    await waitFor(() => expect(useAdminAuth.getState().authorization).toBeNull());
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("keeps the orders on screen and stays signed in when a later request is limited (429)", async () => {
    const { user } = setup(servePage, tooManyRequests);
    await showing(ADMIN_ORDERS_PAGE_SIZE);

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Too many attempts, try again later"));
    expect(await showing(ADMIN_ORDERS_PAGE_SIZE)).toBeInTheDocument();
    expect(useAdminAuth.getState().authorization).toBe(AUTH);
  });
});
