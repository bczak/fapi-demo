import { Link, useParams } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import { useOrder } from "@/entities/order";
import { Button } from "@/shared/ui/button";
import { OrderRecap } from "@/widgets/order-recap";

export function ThankYouPage() {
  const { orderId } = useParams({ from: "/thank-you/$orderId" });
  const { data: order, isPending, isError } = useOrder(orderId);

  if (isPending) return <p className="text-muted-foreground">Loading your order…</p>;
  if (isError) {
    return (
      <div className="grid justify-items-start gap-4">
        <p className="text-destructive">We couldn't find this order.</p>
        <Button asChild variant="outline">
          <Link to="/">Back to the shop</Link>
        </Button>
      </div>
    );
  }

  return (
    <section className="mx-auto grid max-w-3xl gap-6">
      <div className="grid justify-items-center gap-2 text-center">
        <CircleCheck className="size-12 text-green-600" />
        <h1 className="text-3xl font-bold tracking-tight">Thank you for your order!</h1>
        <p className="text-muted-foreground text-sm">
          Order <span className="font-mono">{order.id}</span> has been received.
        </p>
      </div>
      <OrderRecap order={order} />
      <Button asChild variant="outline" className="justify-self-center">
        <Link to="/">Continue shopping</Link>
      </Button>
    </section>
  );
}
