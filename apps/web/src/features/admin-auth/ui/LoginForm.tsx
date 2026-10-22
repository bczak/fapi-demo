import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { fieldError } from "@/shared/lib/form";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";
import { isBasicUser } from "../lib/basic-auth";
import { useAdminAuth } from "../model/store";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required").refine(isBasicUser, "Username cannot contain a colon"),
  password: z.string().min(1, "Password is required"),
});

export function LoginForm() {
  const login = useAdminAuth((s) => s.login);
  const form = useForm({
    defaultValues: { username: "", password: "" },
    validators: { onChange: loginSchema },
    onSubmit: ({ value }) => login(value.username, value.password),
  });

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="username">
        {(f) => (
          <TextField
            name="username"
            label="Username"
            autoComplete="username"
            value={f.state.value}
            onChange={(e) => f.handleChange(e.target.value)}
            onBlur={f.handleBlur}
            error={f.state.meta.isTouched ? fieldError(f.state.meta.errors) : undefined}
          />
        )}
      </form.Field>
      <form.Field name="password">
        {(f) => (
          <TextField
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={f.state.value}
            onChange={(e) => f.handleChange(e.target.value)}
            onBlur={f.handleBlur}
            error={f.state.meta.isTouched ? fieldError(f.state.meta.errors) : undefined}
          />
        )}
      </form.Field>
      <Button type="submit">Sign in</Button>
    </form>
  );
}
