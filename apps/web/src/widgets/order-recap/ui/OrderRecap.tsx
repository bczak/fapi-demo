import { formatCzk, type Order } from "@fapi/shared";
import { OrderDetails } from "@/entities/order";
import { CurrencyConverter } from "@/features/currency-converter";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

/** Thank-you page content: the order details and the total in any other currency. */
export function OrderRecap({ order }: { order: Order }) {
  return (
    <div className="grid gap-6">
      <OrderDetails order={order} />

      <Card>
        <CardHeader>
          <CardTitle>Total in another currency</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-muted-foreground text-sm">
            {formatCzk(order.totalMinor)} incl. VAT, converted with the current ČNB exchange rate.
          </p>
          <CurrencyConverter totalMinor={order.totalMinor} />
        </CardContent>
      </Card>
    </div>
  );
}
