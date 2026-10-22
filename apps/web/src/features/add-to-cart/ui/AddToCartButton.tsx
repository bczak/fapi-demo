import type { Product } from "@fapi/shared";
import { ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { useCartStore, useCartSubmitting } from "@/entities/cart";
import { Button } from "@/shared/ui/button";

export function AddToCartButton({ product }: { product: Product }) {
  const add = useCartStore((s) => s.add);
  const submitting = useCartSubmitting();
  return (
    <Button
      className="w-full"
      disabled={submitting}
      onClick={() => {
        add(product);
        toast.success(`${product.name} added to cart`);
      }}
    >
      <ShoppingCart /> Add to cart
    </Button>
  );
}
