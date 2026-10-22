import { Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";

const CHECKOUT_STEPS = [
  { id: "review", label: "Review" },
  { id: "shipping", label: "Shipping" },
  { id: "payment", label: "Payment" },
] as const;

export type CheckoutStep = (typeof CHECKOUT_STEPS)[number]["id"];

/** "1 Review - 2 Shipping - 3 Payment" progress indicator. */
export function CheckoutSteps({ current }: { current: CheckoutStep }) {
  const currentIndex = CHECKOUT_STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="flex items-center gap-3 text-sm">
      {CHECKOUT_STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li
            key={step.id}
            aria-current={active ? "step" : undefined}
            className={cn("flex items-center gap-2", active ? "font-medium" : "text-muted-foreground")}
          >
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border text-xs",
                (active || done) && "border-primary",
                active && "bg-primary text-primary-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : index + 1}
            </span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
