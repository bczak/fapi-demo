import { MAX_QUANTITY } from "@fapi/shared";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useCartStore } from "@/entities/cart";
import { cartLines, cartWith } from "@/test/cart";
import { CartQuantity } from "./CartQuantity";

/** Gets its line from the store like the product grid and the cart sheet do. */
function Line({ productId }: { productId: number }) {
  const item = useCartStore((s) => s.items.find((i) => i.productId === productId));
  return item ? <CartQuantity item={item} /> : <p>Not in cart</p>;
}

const decrease = () => screen.getByRole("button", { name: "Decrease quantity of Product 1" });
const increase = () => screen.getByRole("button", { name: "Increase quantity of Product 1" });
const remove = () => screen.getByRole("button", { name: "Remove Product 1" });

function setup(quantity: number) {
  cartWith([1, quantity]);
  render(<Line productId={1} />);
  return userEvent.setup({ delay: null });
}

describe("CartQuantity", () => {
  it('"−" at quantity 1 removes the item', async () => {
    const user = setup(1);
    await user.click(decrease());
    expect(cartLines()).toEqual([]);
    expect(screen.getByText("Not in cart")).toBeInTheDocument();
  });

  it('"−" above 1 lowers the quantity by one', async () => {
    const user = setup(3);
    await user.click(decrease());
    expect(cartLines()).toEqual([[1, 2]]);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it('"+" raises the quantity by one, up to the maximum', async () => {
    const user = setup(MAX_QUANTITY - 1);
    await user.click(increase());
    expect(cartLines()).toEqual([[1, MAX_QUANTITY]]);
    expect(increase()).toBeDisabled();
  });

  it("removes the item with the remove button whatever the quantity", async () => {
    const user = setup(5);
    await user.click(remove());
    expect(cartLines()).toEqual([]);
  });

  it("is locked while an order is being placed and works again afterwards", async () => {
    const user = setup(2);
    act(() => useCartStore.getState().setSubmitting(true));
    for (const button of [decrease(), increase(), remove()]) expect(button).toBeDisabled();
    await user.click(remove());
    expect(cartLines()).toEqual([[1, 2]]);

    act(() => useCartStore.getState().setSubmitting(false));
    for (const button of [decrease(), increase(), remove()]) expect(button).toBeEnabled();
  });
});
