import { customerSchema } from "@fapi/shared";
import { describe, expect, it } from "vitest";
import { fieldError } from "./form";

describe("fieldError", () => {
  it("shows the message of the first zod issue", () => {
    const issues = customerSchema.shape.zip.safeParse("1").error?.issues ?? [];
    expect(fieldError(issues)).toBe("Enter a valid ZIP");
  });

  it("shows a plain string error as it is", () => {
    expect(fieldError(["Required", "Too short"])).toBe("Required");
  });

  it.each([
    ["no errors", []],
    ["an empty string", [""]],
    ["null", [null]],
    ["an object without a message", [{ code: "custom" }]],
    ["a message that is not a string", [{ message: 42 }]],
  ])("shows nothing for %s", (_, errors) => {
    expect(fieldError(errors)).toBeUndefined();
  });
});
