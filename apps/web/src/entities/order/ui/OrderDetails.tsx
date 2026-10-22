import { formatMinor, formatRateDate, type Order } from "@fapi/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { OrderLines } from "./OrderLines";

/** Customer, order lines with VAT, and payment details. Used by the thank-you page and the admin. */
export function OrderDetails({ order }: { order: Order }) {
  const { customer, payment } = order;
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          <p className="font-medium">
            {customer.firstName} {customer.lastName}
          </p>
          <p>{customer.email}</p>
          <p>{customer.phone}</p>
          <p>
            {customer.street}, {customer.zip} {customer.city}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Order summary</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderLines order={order} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1">
          <p className="text-2xl font-semibold" data-testid="payment-total">
            {formatMinor(payment.totalMinor, payment.currency)}
          </p>
          <p className="text-muted-foreground text-sm">Currency: {payment.currency}</p>
          {payment.rateDate && (
            <p className="text-muted-foreground text-xs">
              ČNB rate from {formatRateDate(payment.rateDate)}: 1 {payment.currency} ={" "}
              {payment.rate.toLocaleString("cs-CZ")} CZK
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
