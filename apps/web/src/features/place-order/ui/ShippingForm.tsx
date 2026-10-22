import { type Customer, customerSchema } from "@fapi/shared";
import { useForm } from "@tanstack/react-form";
import { fieldError } from "@/shared/lib/form";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

const EMPTY_CUSTOMER: Customer = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  street: "",
  city: "",
  zip: "",
};

interface Props {
  /** Pre-fills the form, e.g. when coming back from the payment step. */
  defaultValues?: Customer;
  onSubmit: (customer: Customer) => void;
  onBack: () => void;
}

/** Step 2 of the checkout: customer and shipping details. */
export function ShippingForm({ defaultValues = EMPTY_CUSTOMER, onSubmit, onBack }: Props) {
  const form = useForm({
    defaultValues,
    validators: { onChange: customerSchema },
    onSubmit: ({ value }) => onSubmit(value),
  });

  const field = (
    name: keyof Customer,
    label: string,
    props: { type?: string; autoComplete?: string; placeholder?: string } = {},
  ) => (
    <form.Field name={name}>
      {(f) => (
        <TextField
          name={name}
          label={label}
          value={f.state.value}
          onChange={(e) => f.handleChange(e.target.value)}
          onBlur={f.handleBlur}
          error={f.state.meta.isTouched ? fieldError(f.state.meta.errors) : undefined}
          {...props}
        />
      )}
    </form.Field>
  );

  return (
    <form
      noValidate
      className="grid gap-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {field("firstName", "First name", { autoComplete: "given-name" })}
        {field("lastName", "Last name", { autoComplete: "family-name" })}
        {field("email", "Email", { type: "email", autoComplete: "email" })}
        {field("phone", "Phone", { type: "tel", autoComplete: "tel", placeholder: "+420 123 456 789" })}
      </div>
      {field("street", "Street and number", { autoComplete: "street-address" })}
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-[3fr_2fr]">
        {field("city", "City", { autoComplete: "address-level2" })}
        {field("zip", "ZIP", { autoComplete: "postal-code", placeholder: "110 00" })}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" size="lg">
          Continue to payment
        </Button>
      </div>
    </form>
  );
}
