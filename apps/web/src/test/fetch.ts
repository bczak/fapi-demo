import { type CreateOrderInput, createOrderSchema } from "@fapi/shared";
import { type Mock, vi } from "vitest";

export type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** Replaces `fetch`. Routes are keyed "METHOD /path" (query string ignored); any other request throws. */
export function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    const key = `${init.method ?? "GET"} ${url.pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A request the server never answers: like a real fetch, it only fails once its signal aborts. */
export const hang: Handler = (_url, { signal }) =>
  new Promise((_resolve, reject) => {
    if (signal?.aborted) reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason));
  });

/** The orders sent to POST /api/orders so far, in order, read as the API reads them (so it fails on one it would refuse). */
export const postedOrders = (fetchMock: Mock<typeof fetch>): CreateOrderInput[] =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => createOrderSchema.parse(JSON.parse(String(init?.body))));

/** The idempotency keys of the orders posted so far, in order. */
export const sentKeys = (fetchMock: Mock<typeof fetch>) =>
  postedOrders(fetchMock).map((order) => order.idempotencyKey);

/** A promise settled from the outside, to keep a request in flight for as long as a test needs. */
export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
