import { ProductGrid } from "@/widgets/product-grid";

export function ShopPage() {
  return (
    <section className="grid gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Products</h1>
      <ProductGrid />
    </section>
  );
}
