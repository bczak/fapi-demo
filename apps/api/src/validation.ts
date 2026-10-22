import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

/** zValidator that answers with a flat `{ message, issues: [{ path, message }] }` body on failure. */
export const validate = <T extends ZodType>(target: "json" | "query" | "param", schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          message: "Validation failed",
          issues: result.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        422,
      );
    }
  });
