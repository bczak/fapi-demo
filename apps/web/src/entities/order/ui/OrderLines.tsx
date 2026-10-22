import { formatCzk, type Order } from "@fapi/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

/** Line items + net / VAT / gross totals of an order. */
export function OrderLines({ order }: { order: Order }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Unit price</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {order.items.map((item) => (
          <TableRow key={item.productId}>
            <TableCell>{item.productName}</TableCell>
            <TableCell className="text-right">{item.quantity}</TableCell>
            <TableCell className="text-right">{formatCzk(item.unitPriceMinor)}</TableCell>
            <TableCell className="text-right">{formatCzk(item.unitPriceMinor * item.quantity)}</TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell colSpan={3} className="text-right">
            Subtotal (excl. VAT)
          </TableCell>
          <TableCell className="text-right">{formatCzk(order.subtotalMinor)}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell colSpan={3} className="text-right">
            VAT {order.vatPercent} %
          </TableCell>
          <TableCell className="text-right">{formatCzk(order.vatMinor)}</TableCell>
        </TableRow>
        <TableRow className="font-semibold">
          <TableCell colSpan={3} className="text-right">
            Total incl. VAT
          </TableCell>
          <TableCell className="text-right">{formatCzk(order.totalMinor)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
