import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { AdminPage } from "@/pages/admin";
import { ShopPage } from "@/pages/shop";
import { ThankYouPage } from "@/pages/thank-you";
import { CartSheet } from "@/widgets/cart-sheet";
import { Header } from "@/widgets/header";

const rootRoute = createRootRoute({
  component: () => (
    <>
      <Header actions={<CartSheet />} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </>
  ),
});

const shopRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: ShopPage });
const thankYouRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/thank-you/$orderId",
  component: ThankYouPage,
});
const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: "/admin", component: AdminPage });

const routeTree = rootRoute.addChildren([shopRoute, thankYouRoute, adminRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
