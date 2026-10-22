import { useEffect } from "react";
import { toast } from "sonner";
import { useAdminOrders, useRefreshAdminOrders } from "@/entities/order";
import { authFailure, LoginForm, useAdminAuth, useSignOut } from "@/features/admin-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { AdminOrdersTable, OrdersPager } from "@/widgets/admin-orders";

export function AdminPage() {
  const authorization = useAdminAuth((s) => s.authorization);
  return authorization ? <Orders authorization={authorization} /> : <Login />;
}

function Login() {
  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>Admin</CardTitle>
        <CardDescription>Sign in to see incoming orders.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}

function Orders({ authorization }: { authorization: string }) {
  const signOut = useSignOut();
  const { data, error, isPending, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } =
    useAdminOrders(authorization);
  const refresh = useRefreshAdminOrders();
  const hasOrders = data !== undefined;

  useEffect(() => {
    const failure = authFailure(error);
    if (!failure) return;
    toast.error(failure.message);
    // Wrong credentials, or a lockout before any order loaded: back to the form. A lockout
    // while orders are on screen keeps them; the next refresh picks up once it is over.
    if (failure.rejected || !hasOrders) signOut();
  }, [error, hasOrders, signOut]);

  return (
    <section className="grid gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
      {isPending ? (
        <p role="status" className="text-muted-foreground">
          Loading orders…
        </p>
      ) : !data ? (
        <p className="text-destructive">Could not load orders.</p>
      ) : (
        <>
          <AdminOrdersTable orders={data.orders} />
          <OrdersPager
            shown={data.orders.length}
            total={data.total}
            hasMore={hasNextPage}
            isLoadingMore={isFetchingNextPage}
            loadMoreFailed={isFetchNextPageError}
            onLoadMore={() => fetchNextPage()}
            autoRefresh={data.autoRefresh}
            onRefresh={refresh}
          />
        </>
      )}
    </section>
  );
}
