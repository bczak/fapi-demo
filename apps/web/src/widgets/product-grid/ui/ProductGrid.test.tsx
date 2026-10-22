import { act, screen } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCartStore } from "@/entities/cart";
import { cartLines, cartWith } from "@/test/cart";
import { stubFetch } from "@/test/fetch";
import { product } from "@/test/fixtures";
import { renderWithClient } from "@/test/render";
import { ProductGrid } from "./ProductGrid";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const addButton = () => screen.findByRole("button", { name: "Add to cart" });

beforeEach(() => {
  cartWith();
  stubFetch({ "GET /api/products": () => Response.json({ items: [product(1)], total: 1 }) });
});

describe("ProductGrid cart controls", () => {
  it('turns "Add to cart" into a stepper, and "−" at 1 brings the button back', async () => {
    const { user } = renderWithClient(<ProductGrid />);

    await user.click(await addButton());
    expect(toast.success).toHaveBeenCalledWith("Product 1 added to cart");
    expect(cartLines()).toEqual([[1, 1]]);
    expect(screen.queryByRole("button", { name: "Add to cart" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Decrease quantity of Product 1" }));
    expect(cartLines()).toEqual([]);
    expect(await addButton()).toBeInTheDocument();
  });

  it("locks the button and the stepper while an order is being placed", async () => {
    const { user } = renderWithClient(<ProductGrid />);
    const add = await addButton();

    act(() => useCartStore.getState().setSubmitting(true));
    expect(add).toBeDisabled();

    act(() => useCartStore.getState().setSubmitting(false));
    await user.click(add);
    act(() => useCartStore.getState().setSubmitting(true));
    for (const name of [
      "Decrease quantity of Product 1",
      "Increase quantity of Product 1",
      "Remove Product 1",
    ]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });
});
