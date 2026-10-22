import { describe, expect, it } from "vitest";
import { ApiError } from "@/shared/api/client";
import { authFailure } from "./auth-failure";

describe("authFailure", () => {
  it("reports rejected credentials on 401", () => {
    expect(authFailure(new ApiError(401, "Unauthorized"))).toEqual({
      message: "Invalid credentials",
      rejected: true,
    });
  });

  it("reports a clear rate-limit message on 429", () => {
    expect(authFailure(new ApiError(429, "Too many requests"))).toEqual({
      message: "Too many attempts, try again later",
      rejected: false,
    });
  });

  it.each([500, 503, 422])("ignores other API errors (%s)", (status) => {
    expect(authFailure(new ApiError(status, "boom"))).toBeUndefined();
  });

  it("ignores errors that did not come from the API", () => {
    expect(authFailure(new TypeError("Failed to fetch"))).toBeUndefined();
    expect(authFailure(null)).toBeUndefined();
  });
});
