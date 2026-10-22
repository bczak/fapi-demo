import type { ComponentProps } from "react";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

interface TextFieldProps extends ComponentProps<typeof Input> {
  label: string;
  error?: string;
}

/**
 * Label + input + validation message, used by all forms.
 * The message line is always rendered, so showing an error never shifts the layout.
 */
export function TextField({ label, error, id, name, ...props }: TextFieldProps) {
  const inputId = id ?? name;
  const errorId = `${inputId}-error`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <Input id={inputId} name={name} aria-invalid={!!error} aria-describedby={errorId} {...props} />
      <p id={errorId} className="text-destructive min-h-4 text-xs leading-4">
        {error}
      </p>
    </div>
  );
}
