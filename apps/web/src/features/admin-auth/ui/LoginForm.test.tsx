import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeBasicAuth } from "../lib/basic-auth";
import { useAdminAuth } from "../model/store";
import { LoginForm } from "./LoginForm";

async function signIn(username: string, password: string) {
  const user = userEvent.setup({ delay: null });
  render(<LoginForm />);
  if (username) await user.type(screen.getByLabelText("Username"), username);
  if (password) await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  useAdminAuth.setState({ authorization: null });
});

describe("LoginForm", () => {
  it("signs in with a UTF-8 Basic header, also for non-ASCII passwords", async () => {
    await signIn("admin", "příliš");

    await waitFor(() =>
      expect(useAdminAuth.getState().authorization).toBe(encodeBasicAuth("admin", "příliš")),
    );
  });

  it("explains that a username cannot contain a colon and does not sign in", async () => {
    await signIn("ad:min", "password");

    expect(await screen.findByText("Username cannot contain a colon")).toBeInTheDocument();
    expect(useAdminAuth.getState().authorization).toBeNull();
  });

  it("asks for both fields", async () => {
    await signIn("", "");

    expect(await screen.findByText("Username is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(useAdminAuth.getState().authorization).toBeNull();
  });
});
