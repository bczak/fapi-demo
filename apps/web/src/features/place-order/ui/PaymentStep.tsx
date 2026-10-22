import {
  type Customer,
  formatMinor,
  formatRateDate,
  type Order,
  PAYMENT_CURRENCIES,
  type PaymentCurrency,
  quotePayment,
} from "@fapi/shared";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CartTotals, useCartStore, useCartSubmitting, useCartTotals } from "@/entities/cart";
import { useRates } from "@/entities/exchange-rate";
import { useCreateOrder } from "@/entities/order";
import { ApiError, ApiTimeoutError } from "@/shared/api/client";
import { Button } from "@/shared/ui/button";
import { submitOrder } from "../model/submitOrder";

interface Props {
  customer: Customer;
  onBack: () => void;
  onPlaced: () => void;
}

const FALLBACK_ERROR = "Could not place the order. Check your connection and try again.";

/**
 * Step 3 of the checkout: pick the payment currency. Other currencies than CZK are priced with the
 * live ČNB rate; the server calculates (and stores) the final amount when the order is placed.
 * While the request is in flight everything on the cart and on this step is locked.
 */
export function PaymentStep({ customer, onBack, onPlaced }: Props) {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const submitting = useCartSubmitting();
  const totals = useCartTotals();
  const rates = useRates();
  const createOrder = useCreateOrder();
  const [currency, setCurrency] = useState<PaymentCurrency>("CZK");

  const options = PAYMENT_CURRENCIES.map((code) => ({
    code,
    quote: quotePayment(totals.totalMinor, code, rates.data),
  }));
  const selected = options.find((o) => o.code === currency)?.quote;

  async function placeOrder() {
    const snapshot = {
      customer,
      currency,
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    };
    let order: Order;
    try {
      order = await submitOrder(snapshot, createOrder.mutateAsync);
    } catch (e) {
      // The client's own errors read well; the browser's (e.g. "Failed to fetch") do not.
      const readable = e instanceof ApiError || e instanceof ApiTimeoutError;
      toast.error(readable ? e.message : FALLBACK_ERROR, {
        description: "Your cart is kept, you can try again.",
      });
      return;
    }
    onPlaced();
    await navigate({ to: "/thank-you/$orderId", params: { orderId: order.id } });
  }

  return (
    <div className="grid gap-6">
      <CartTotals />

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Payment currency</legend>
        {options.map(({ code, quote }) => (
          <label
            key={code}
            className="flex cursor-pointer items-center justify-between rounded-lg border p-4 has-checked:border-primary has-checked:bg-accent has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
          >
            <input
              type="radio"
              name="currency"
              value={code}
              className="sr-only"
              checked={currency === code}
              disabled={!quote || submitting}
              onChange={() => setCurrency(code)}
            />
            <span className="font-medium">{code}</span>
            <span className="tabular-nums">
              {quote ? formatMinor(quote.totalMinor, code) : rates.isPending ? "…" : "Unavailable"}
            </span>
          </label>
        ))}
        {selected?.rateDate ? (
          <p className="text-muted-foreground text-xs">
            Live ČNB rate from {formatRateDate(selected.rateDate)}: 1 {selected.currency} ={" "}
            {selected.rate.toLocaleString("cs-CZ")} CZK. The final amount is calculated by the server when you
            place the order.
          </p>
        ) : null}
        {rates.isError && (
          <p className="text-muted-foreground text-xs">
            Exchange rates are currently unavailable, you can still pay in CZK.
          </p>
        )}
      </fieldset>

      <p className="text-muted-foreground text-xs">Demo shop: nothing is charged.</p>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" size="lg" onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button size="lg" onClick={placeOrder} disabled={submitting || !selected}>
          {submitting
            ? "Placing order…"
            : selected
              ? `Pay ${formatMinor(selected.totalMinor, selected.currency)}`
              : "Place order"}
        </Button>
      </div>
    </div>
  );
}
