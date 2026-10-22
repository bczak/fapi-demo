import { formatCzk } from "@fapi/shared";
import { useCartTotals } from "../model/store";

/** Subtotal, VAT and total incl. VAT of the current cart. */
export function CartTotals() {
  const totals = useCartTotals();
  return (
    <dl className="grid gap-1 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Subtotal (excl. VAT)</dt>
        <dd>{formatCzk(totals.subtotalMinor)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">VAT 21 %</dt>
        <dd>{formatCzk(totals.vatMinor)}</dd>
      </div>
      <div className="flex justify-between text-base font-semibold">
        <dt>Total incl. VAT</dt>
        <dd>{formatCzk(totals.totalMinor)}</dd>
      </div>
    </dl>
  );
}
