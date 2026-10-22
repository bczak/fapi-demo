import { formatCzk } from "@fapi/shared";
import { TriangleAlert } from "lucide-react";
import type { CartChanges } from "@/entities/cart";

/** What the catalogue check changed in the cart: new prices (net, per piece) and products that are gone. */
export function CartChangesNotice({ changes }: { changes: CartChanges }) {
  return (
    <div
      role="alert"
      className="grid gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4 shrink-0" /> Your cart has changed
      </p>
      <ul className="grid gap-1">
        {changes.repriced.map((change) => (
          <li key={change.productId}>
            {change.name}: {formatCzk(change.oldPriceMinor)} → {formatCzk(change.newPriceMinor)} each
          </li>
        ))}
        {changes.removed.map((item) => (
          <li key={item.productId}>{item.name} is no longer available and was removed.</li>
        ))}
      </ul>
      <p className="text-muted-foreground">The total now uses the current prices. Check it before you pay.</p>
    </div>
  );
}
