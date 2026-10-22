import { formatCzk, formatMinor, type Order } from "@fapi/shared";
import { useState } from "react";
import { OrderDetails } from "@/entities/order";
import { Button } from "@/shared/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

const dateFormat = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short" });
const shortId = (id: string) => id.slice(0, 8);

export function AdminOrdersTable({ orders }: { orders: Order[] }) {
  const [selected, setSelected] = useState<Order>();

  if (orders.length === 0) {
    return <p className="text-muted-foreground py-8 text-center">No orders yet.</p>;
  }
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Items</TableHead>
            <TableHead className="text-right">Total incl. VAT</TableHead>
            <TableHead className="text-right">Paid in</TableHead>
            <TableHead>
              <span className="sr-only">Details</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o.id}>
              <TableCell className="whitespace-nowrap">{dateFormat.format(new Date(o.createdAt))}</TableCell>
              <TableCell>
                <p className="font-medium">
                  {o.customer.firstName} {o.customer.lastName}
                </p>
                <p className="text-muted-foreground text-xs">{o.customer.email}</p>
              </TableCell>
              <TableCell>
                <ul className="text-sm">
                  {o.items.map((i) => (
                    <li key={i.productId}>
                      {i.quantity}× {i.productName}
                    </li>
                  ))}
                </ul>
              </TableCell>
              <TableCell className="text-right font-medium whitespace-nowrap">
                {formatCzk(o.totalMinor)}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                {formatMinor(o.payment.totalMinor, o.payment.currency)}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`View order ${shortId(o.id)}`}
                  onClick={() => setSelected(o)}
                >
                  View
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Sheet open={selected !== undefined} onOpenChange={(open) => !open && setSelected(undefined)}>
        <SheetContent className="sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>Order {shortId(selected.id)}</SheetTitle>
                <SheetDescription>Placed {dateFormat.format(new Date(selected.createdAt))}</SheetDescription>
              </SheetHeader>
              <OrderDetails order={selected} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
