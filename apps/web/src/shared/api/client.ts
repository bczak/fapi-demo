import { type ApiErrorCode, type ApiIssue, apiErrorSchema } from "@fapi/shared";
import type { z } from "zod";

/** How long a request may take, body included, unless the call sets its own `timeoutMs`. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** The API answered with an error, or with something that is not the response it should send. */
export class ApiError extends Error {
  /** Tells apart answers with the same status, e.g. the two 409s of POST /orders. */
  code: ApiErrorCode | undefined;

  constructor(
    public status: number,
    message: string,
    public issues: ApiIssue[] = [],
    { code, ...options }: ErrorOptions & { code?: ApiErrorCode } = {},
  ) {
    super(message, options);
    this.code = code;
  }
}

/** The API did not answer within the request's timeout. */
export class ApiTimeoutError extends Error {
  constructor() {
    super("The server did not answer in time.");
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  /** Gives up after this many milliseconds (15 s by default). */
  timeoutMs?: number;
  /** Lets the caller cancel the request, e.g. React Query's signal for a query it no longer needs. */
  signal?: AbortSignal;
}

/** Calls the API and checks the answer against `schema`: data that does not fit is an ApiError, never returned. */
export async function api<S extends z.ZodType>(
  path: string,
  schema: S,
  { timeoutMs = DEFAULT_TIMEOUT_MS, signal: cancel, ...request }: RequestOptions = {},
): Promise<z.infer<S>> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = cancel ? AbortSignal.any([timeout, cancel]) : timeout;
  try {
    return await send(path, schema, request, signal);
  } catch (e) {
    // The timeout fails the request or the reading of its body. An answer that did arrive (an ApiError)
    // is reported as it is, and so is a cancellation by the caller.
    if (timeout.aborted && !(e instanceof ApiError)) throw new ApiTimeoutError();
    throw e;
  }
}

async function send<S extends z.ZodType>(
  path: string,
  schema: S,
  { method = "GET", body, headers }: Omit<RequestOptions, "timeoutMs" | "signal">,
  signal: AbortSignal,
): Promise<z.infer<S>> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    // HTTP/2 has no status text, and a proxy in front of the API may answer with an HTML page.
    const error = apiErrorSchema.safeParse(await readJson(res));
    const message = error.data?.message ?? (res.statusText || `Request failed with status ${res.status}`);
    throw new ApiError(res.status, message, error.data?.issues, { code: error.data?.code });
  }
  const result = schema.safeParse(await readJson(res));
  if (!result.success) {
    throw new ApiError(res.status, "Unexpected response from the server", [], { cause: result.error });
  }
  return result.data;
}

/** The body as JSON, or undefined when it is not JSON at all. A failed read (e.g. the timeout) throws. */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
