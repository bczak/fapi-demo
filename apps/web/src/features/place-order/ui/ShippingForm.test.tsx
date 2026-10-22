import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { customer } from "@/test/fixtures";
import { ShippingForm } from "./ShippingForm";

const onSubmit = vi.fn();

/** Fills in the fixture customer with `phone` and submits the form. */
async function submitWithPhone(phone: string) {
  const user = userEvent.setup({ delay: null });
  render(<ShippingForm onSubmit={onSubmit} onBack={vi.fn()} />);
  const fields: [label: string, value: string][] = [
    ["First name", customer.firstName],
    ["Last name", customer.lastName],
    ["Email", customer.email],
    ["Phone", phone],
    ["Street and number", customer.street],
    ["City", customer.city],
    ["ZIP", customer.zip],
  ];
  for (const [label, value] of fields) await user.type(screen.getByLabelText(label), value);
  await user.click(screen.getByRole("button", { name: "Continue to payment" }));
}

describe("ShippingForm phone", () => {
  // 12 digits either way, so only the length decides.
  const longest = "+420 12 3 4 5 6 7 89";
  const tooLong = "+420 12 3 4 5 6 7 8 9";

  it("accepts a phone of 20 characters", async () => {
    expect(longest).toHaveLength(20);
    await submitWithPhone(longest);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ ...customer, phone: longest }));
  });

  it("rejects a phone of 21 characters with the phone message", async () => {
    expect(tooLong).toHaveLength(21);
    await submitWithPhone(tooLong);

    expect(await screen.findByText("Enter a valid phone number")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone")).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
