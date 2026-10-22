import { ApiError } from "@/shared/api/client";

export interface AuthFailure {
  message: string;
  /** True when the server rejected the credentials, false when it refused to check them (429). */
  rejected: boolean;
}

/** The login problem behind `error`: wrong credentials (401) or too many attempts (429). */
export function authFailure(error: unknown): AuthFailure | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.status === 401) return { message: "Invalid credentials", rejected: true };
  if (error.status === 429) return { message: "Too many attempts, try again later", rejected: false };
  return undefined;
}
