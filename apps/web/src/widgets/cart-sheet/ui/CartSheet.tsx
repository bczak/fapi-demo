import { type Customer, formatCzk, type PaymentCurrency } from "@fapi/shared";
import { ShoppingCart } from "lucide-react";
import { useState } from "react";
import { type CartChanges, CartTotals, mergeCartChanges, useCartCount, useCartStore } from "@/entities/cart";
import { usePrefetchRates } from "@/entities/exchange-rate";
import { CartQuantity } from "@/features/cart-quantity";
import { PaymentStep, pendingSnapshot, refreshCart, ShippingForm } from "@/features/place-order";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";
import { CartChangesNotice } from "./CartChangesNotice";
import { type CheckoutStep, CheckoutSteps } from "./CheckoutSteps";

const HEADINGS: Record<CheckoutStep, { title: string; description: string }> = {
  review: { title: "Your cart", description: "Review your items and the price." },
  shipping: { title: "Shipping", description: "Where should we send your order?" },
  payment: { title: "Payment", description: "Choose the currency you want to pay in." },
};

/**
 * Cart icon with item count. Opens a side sheet (full screen on phones) with a 3-step checkout:
 * review the items, enter shipping details, choose the payment currency.
 * The checkout so far (customer, currency) lives here, above the steps, so moving between them keeps it.
 */
export function CartSheet() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<CheckoutStep>("review");
  const [customer, setCustomer] = useState<Customer>();
  const [currency, setCurrency] = useState<PaymentCurrency>("CZK");
  const [changes, setChanges] = useState<CartChanges>();
  const count = useCartCount();
  const items = useCartStore((s) => s.items);
  const prefetchRates = usePrefetchRates();

  const heading = HEADINGS[step];

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) return;
    // The payment step needs the ČNB rates; loading them now usually has them ready by then.
    prefetchRates();
    // After a reload: the order sent without an answer fills in the checkout again, so paying
    // repeats the same request (and its key) instead of placing a second order.
    const pending = pendingSnapshot();
    if (!customer && pending) {
      setCustomer(pending.customer);
      setCurrency(pending.currency);
    }
    // Prices may have changed since the products were added. Pay checks again, so a failure here can wait.
    if (!useCartStore.getState().submitting) void refreshCart().then(showChanges, () => {});
  }

  // The notice stays until the customer pays (confirming it) or the order is placed: a check that finds
  // nothing new must not hide a change they have not confirmed yet.
  function showChanges(found: CartChanges | undefined) {
    if (found) setChanges((shown) => mergeCartChanges(shown, found));
  }

  function finish() {
    setOpen(false);
    setStep("review");
    setCustomer(undefined);
    setCurrency("CZK");
    setChanges(undefined);
  }

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="relative" aria-label={`Open cart, ${count} items`}>
          <ShoppingCart />
          {count > 0 && (
            <Badge
              data-testid="cart-count"
              className="absolute -top-2 -right-2 h-5 min-w-5 justify-center rounded-full px-1"
            >
              {count}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{heading.title}</SheetTitle>
          <SheetDescription>{heading.description}</SheetDescription>
        </SheetHeader>

        {changes && <CartChangesNotice changes={changes} />}

        {items.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center">Your cart is empty.</p>
        ) : (
          <div className="grid gap-6">
            <CheckoutSteps current={step} />

            {step === "review" && (
              <>
                <ul className="divide-y">
                  {items.map((item) => (
                    <li key={item.productId} className="grid gap-2 py-3">
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="font-medium">{item.name}</p>
                        <span className="tabular-nums">{formatCzk(item.priceMinor * item.quantity)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-muted-foreground text-sm">{formatCzk(item.priceMinor)} each</p>
                        <CartQuantity item={item} deleteFirst />
                      </div>
                    </li>
                  ))}
                </ul>

                <CartTotals />

                <Button size="lg" onClick={() => setStep("shipping")}>
                  Continue to shipping
                </Button>
              </>
            )}

            {step === "shipping" && (
              <ShippingForm
                defaultValues={customer}
                onBack={() => setStep("review")}
                onSubmit={(value) => {
                  setCustomer(value);
                  setStep("payment");
                }}
              />
            )}

            {step === "payment" && customer && (
              <PaymentStep
                customer={customer}
                currency={currency}
                onCurrencyChange={setCurrency}
                onCartChange={setChanges}
                onBack={() => setStep("shipping")}
                onPlaced={finish}
              />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
