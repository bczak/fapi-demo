/** Turns TanStack Form errors (zod issues or strings) into one message to show under a field. */
export function fieldError(errors: ReadonlyArray<unknown>): string | undefined {
  const first = errors[0];
  if (typeof first === "string") return first || undefined;
  if (typeof first === "object" && first && "message" in first && typeof first.message === "string") {
    return first.message;
  }
  return undefined;
}
