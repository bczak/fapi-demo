import { type Customer, formatCzk } from "@fapi/shared";
import { ShoppingCart } from "lucide-react";
import { useState } from "react";
import { CartTotals, useCartCount, useCartStore } from "@/entities/cart";
import { CartQuantity } from "@/features/cart-quantity";
import { PaymentStep, ShippingForm } from "@/features/place-order";
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
import { type CheckoutStep, CheckoutSteps } from "./CheckoutSteps";

const HEADINGS: Record<CheckoutStep, { title: string; description: string }> = {
  review: { title: "Your cart", description: "Review your items and the price." },
  shipping: { title: "Shipping", description: "Where should we send your order?" },
  payment: { title: "Payment", description: "Choose the currency you want to pay in." },
};

/**
 * Cart icon with item count. Opens a side sheet (full screen on phones) with a 3-step checkout:
 * review the items, enter shipping details, choose the payment currency.
 */
export function CartSheet() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<CheckoutStep>("review");
  const [customer, setCustomer] = useState<Customer>();
  const count = useCartCount();
  const items = useCartStore((s) => s.items);

  const heading = HEADINGS[step];

  function finish() {
    setOpen(false);
    setStep("review");
    setCustomer(undefined);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
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
              <PaymentStep customer={customer} onBack={() => setStep("shipping")} onPlaced={finish} />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
