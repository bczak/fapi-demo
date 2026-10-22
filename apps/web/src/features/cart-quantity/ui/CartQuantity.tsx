import { MAX_QUANTITY } from "@fapi/shared";
import { Minus, Plus, Trash2 } from "lucide-react";
import { type CartItem, useCartStore, useCartSubmitting } from "@/entities/cart";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

interface Props {
  item: CartItem;
  /** Puts the remove button before "−" instead of after "+". */
  deleteFirst?: boolean;
  className?: string;
}

/**
 * Quantity stepper (− count +) and a red remove button. "−" at 1 removes the item.
 * Disabled while an order is being placed, so the cart cannot change under the request.
 */
export function CartQuantity({ item, deleteFirst = false, className }: Props) {
  const setQuantity = useCartStore((s) => s.setQuantity);
  const remove = useCartStore((s) => s.remove);
  const submitting = useCartSubmitting();

  const removeButton = (
    <Button
      variant="destructive"
      size="icon"
      className="size-8"
      aria-label={`Remove ${item.name}`}
      disabled={submitting}
      onClick={() => remove(item.productId)}
    >
      <Trash2 />
    </Button>
  );

  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      {deleteFirst && removeButton}
      <div className="flex items-center">
        <Button
          size="icon"
          className="size-8"
          aria-label={`Decrease quantity of ${item.name}`}
          disabled={submitting}
          onClick={() =>
            item.quantity <= 1 ? remove(item.productId) : setQuantity(item.productId, item.quantity - 1)
          }
        >
          <Minus />
        </Button>
        <span className="min-w-8 px-2 text-center tabular-nums">
          <span className="sr-only">Quantity: </span>
          {item.quantity}
        </span>
        <Button
          size="icon"
          className="size-8"
          aria-label={`Increase quantity of ${item.name}`}
          disabled={submitting || item.quantity >= MAX_QUANTITY}
          onClick={() => setQuantity(item.productId, item.quantity + 1)}
        >
          <Plus />
        </Button>
      </div>
      {!deleteFirst && removeButton}
    </div>
  );
}
