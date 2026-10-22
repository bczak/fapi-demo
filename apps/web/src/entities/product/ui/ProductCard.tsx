import { formatCzk, type Product } from "@fapi/shared";
import { Package } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";

interface Props {
  product: Product;
  /** Slot for the action, e.g. an "Add to cart" button. */
  action: ReactNode;
}

export function ProductCard({ product, action }: Props) {
  return (
    <Card className="overflow-hidden pt-0">
      <div className="bg-muted text-muted-foreground flex aspect-4/3 items-center justify-center">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} loading="lazy" className="size-full object-cover" />
        ) : (
          <Package className="size-10" />
        )}
      </div>
      <CardHeader>
        <CardTitle>{product.name}</CardTitle>
        <CardDescription>{product.description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <p className="text-xl font-semibold">{formatCzk(product.priceMinor)}</p>
        <p className="text-muted-foreground text-xs">excl. VAT</p>
      </CardContent>
      <CardFooter>{action}</CardFooter>
    </Card>
  );
}

/** Placeholder with the same layout as ProductCard, shown while products load. */
export function ProductCardSkeleton() {
  return (
    <Card className="overflow-hidden pt-0" aria-hidden>
      <Skeleton className="aspect-4/3 rounded-none" />
      <CardHeader>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </CardHeader>
      <CardContent className="mt-auto">
        <Skeleton className="h-7 w-24" />
      </CardContent>
      <CardFooter>
        <Skeleton className="h-9 w-full" />
      </CardFooter>
    </Card>
  );
}
