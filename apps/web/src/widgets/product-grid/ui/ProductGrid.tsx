import { PRODUCTS_PAGE_SIZE, type Product } from "@fapi/shared";
import { LoaderCircle } from "lucide-react";
import { useCartStore } from "@/entities/cart";
import { ProductCard, ProductCardSkeleton, useProducts } from "@/entities/product";
import { AddToCartButton } from "@/features/add-to-cart";
import { CartQuantity } from "@/features/cart-quantity";
import { Button } from "@/shared/ui/button";

const GRID = "grid gap-6 sm:grid-cols-2 lg:grid-cols-3";
const SKELETON_KEYS = Array.from({ length: PRODUCTS_PAGE_SIZE }, (_, i) => `skeleton-${i}`);

/** "Add to cart" until the product is in the cart, then a quantity stepper with remove. */
function ProductAction({ product }: { product: Product }) {
  const item = useCartStore((s) => s.items.find((i) => i.productId === product.id));
  return item ? <CartQuantity item={item} className="h-9 w-full" /> : <AddToCartButton product={product} />;
}

export function ProductGrid() {
  const { data, isPending, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } =
    useProducts();

  if (isPending) {
    return (
      <div className={GRID} role="status" aria-label="Loading products">
        {SKELETON_KEYS.map((key) => (
          <ProductCardSkeleton key={key} />
        ))}
      </div>
    );
  }
  if (!data) return <p className="text-destructive">Could not load products. Please try again.</p>;

  const products = data.pages.flatMap((p) => p.items);
  const total = data.pages.at(-1)?.total ?? products.length;

  return (
    <div className="grid gap-8">
      <div className={GRID}>
        {products.map((product) => (
          <ProductCard key={product.id} product={product} action={<ProductAction product={product} />} />
        ))}
        {isFetchingNextPage && SKELETON_KEYS.map((key) => <ProductCardSkeleton key={key} />)}
      </div>

      <div className="flex flex-col items-center gap-3">
        <p className="text-muted-foreground text-sm">
          Showing {products.length} of {total} products
        </p>
        {isFetchNextPageError && (
          <p className="text-destructive text-sm">Could not load more products. Please try again.</p>
        )}
        {hasNextPage && (
          <Button variant="outline" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
            {isFetchingNextPage && <LoaderCircle className="animate-spin" />}
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </div>
  );
}
