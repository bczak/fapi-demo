import {
  type Customer,
  formatMinor,
  formatRateDate,
  PAYMENT_CURRENCIES,
  type PaymentCurrency,
  quotePayment,
} from "@fapi/shared";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  type CartChanges,
  CartTotals,
  useCartStore,
  useCartSubmitting,
  useCartTotals,
} from "@/entities/cart";
import { useRates } from "@/entities/exchange-rate";
import { useCreateOrder } from "@/entities/order";
import { ApiError, ApiTimeoutError } from "@/shared/api/client";
import { Button } from "@/shared/ui/button";
import { repeatsAttempt } from "../model/idempotency";
import { type ConfirmedOrder, type SubmitResult, submitOrder } from "../model/submitOrder";

interface Props {
  customer: Customer;
  /** Kept by the parent, so going back to shipping and forward again keeps the choice. */
  currency: PaymentCurrency;
  onCurrencyChange: (currency: PaymentCurrency) => void;
  /** The cart changed under the order (undefined once Pay is pressed again, confirming the new total). */
  onCartChange: (changes: CartChanges | undefined) => void;
  onBack: () => void;
  onPlaced: () => void;
}

const FALLBACK_ERROR = "Could not place the order. Check your connection and try again.";

/**
 * Step 3 of the checkout: pick the payment currency. Other currencies than CZK are priced with the
 * live ČNB rate; the server calculates (and stores) the final amount when the order is placed.
 * Without the rates they can only be paid as a retry of the order sent without an answer.
 * While the request is in flight everything on the cart and on this step is locked.
 */
export function PaymentStep({ customer, currency, onCurrencyChange, onCartChange, onBack, onPlaced }: Props) {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const submitting = useCartSubmitting();
  const totals = useCartTotals();
  const rates = useRates();
  const createOrder = useCreateOrder();

  // The total on the Pay button is the one the customer confirms; the server places the order at no other.
  const orderIn = (code: PaymentCurrency): ConfirmedOrder => ({
    customer,
    currency: code,
    items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    expectedTotalMinor: totals.totalMinor,
  });

  const options = PAYMENT_CURRENCIES.map((code) => {
    const quote = quotePayment(totals.totalMinor, code, rates.data);
    // Without rates, the order sent without an answer (e.g. before a reload) can still be sent again:
    // the server answers it from its key, and needs the rates only if that order never got through.
    const retry = !quote && !rates.isPending && repeatsAttempt(orderIn(code));
    return { code, quote, retry };
  });
  const chosen = options.find((o) => o.code === currency);
  const selected = chosen?.quote;
  const retry = chosen?.retry ?? false;

  async function placeOrder() {
    // Paying with changes on show confirms them; new ones come back in the result.
    onCartChange(undefined);
    let result: SubmitResult;
    try {
      result = await submitOrder(orderIn(currency), createOrder.mutateAsync);
    } catch (e) {
      // The client's own errors read well; the browser's (e.g. "Failed to fetch") do not.
      const readable = e instanceof ApiError || e instanceof ApiTimeoutError;
      toast.error(readable ? e.message : FALLBACK_ERROR, {
        description: "Your cart is kept, you can try again.",
      });
      return;
    }
    if ("changes" in result) {
      onCartChange(result.changes);
      return;
    }
    onPlaced();
    await navigate({ to: "/thank-you/$orderId", params: { orderId: result.order.id } });
  }

  function payLabel() {
    if (submitting) return "Placing order…";
    if (selected) return `Pay ${formatMinor(selected.totalMinor, selected.currency)}`;
    return retry ? "Retry payment" : "Place order";
  }

  return (
    <div className="grid gap-6">
      <CartTotals />

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Payment currency</legend>
        {options.map(({ code, quote, retry: retryable }) => (
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
              disabled={!(quote || retryable) || submitting}
              onChange={() => onCurrencyChange(code)}
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
        {retry && (
          <p className="text-muted-foreground text-xs">
            Your payment in {currency} was sent but got no answer. You can retry it without the exchange rate:
            the amount is shown once the order is confirmed.
          </p>
        )}
      </fieldset>

      <p className="text-muted-foreground text-xs">Demo shop: nothing is charged.</p>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" size="lg" onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button size="lg" onClick={placeOrder} disabled={submitting || !(selected || retry)}>
          {payLabel()}
        </Button>
      </div>
    </div>
  );
}
