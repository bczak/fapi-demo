import { cnbRatesSchema, orderSchema, productPageSchema } from "@fapi/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hang, stubFetch } from "@/test/fetch";
import { order, product } from "@/test/fixtures";
import { ApiError, ApiTimeoutError, api } from "./client";

const page = { items: [product(1)], total: 1 };

afterEach(() => vi.restoreAllMocks());

describe("api: answers", () => {
  it("returns the answer once it fits the schema", async () => {
    stubFetch({ "GET /api/products": () => Response.json(page) });
    await expect(api("/products", productPageSchema)).resolves.toEqual(page);
  });

  it("sends a body as JSON", async () => {
    const fetchMock = stubFetch({ "POST /api/orders": () => Response.json(order(), { status: 201 }) });
    await api("/orders", orderSchema, { method: "POST", body: { hello: "world" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orders",
      expect.objectContaining({ body: '{"hello":"world"}', headers: { "Content-Type": "application/json" } }),
    );
  });

  it.each([
    ["a price sent as text", { items: [{ ...product(1), priceMinor: "100.00" }], total: 1 }],
    ["a bare list instead of a page", [product(1)]],
    ["an error body with a success status", { message: "Internal server error" }],
  ])("rejects %s instead of passing it on", async (_, body) => {
    stubFetch({ "GET /api/products": () => Response.json(body) });
    const request = api("/products", productPageSchema);
    await expect(request).rejects.toThrow(ApiError);
    await expect(request).rejects.toMatchObject({
      status: 200,
      message: "Unexpected response from the server",
    });
  });

  it("rejects a success answer that is not JSON at all", async () => {
    stubFetch({ "GET /api/products": () => new Response("<!doctype html><title>Shop</title>") });
    await expect(api("/products", productPageSchema)).rejects.toMatchObject({
      status: 200,
      message: "Unexpected response from the server",
    });
  });
});

describe("api: errors", () => {
  it("carries the status, message and issues of the API's error body", async () => {
    const issues = [{ path: "customer.email", message: "Enter a valid email address" }];
    stubFetch({
      "POST /api/orders": () => Response.json({ message: "Validation failed", issues }, { status: 422 }),
    });
    const request = api("/orders", orderSchema, { method: "POST", body: {} });
    await expect(request).rejects.toThrow(ApiError);
    await expect(request).rejects.toMatchObject({ status: 422, message: "Validation failed", issues });
  });

  it("falls back to the status text when the error body is not the API's, e.g. a proxy page", async () => {
    stubFetch({
      "GET /api/rates": () =>
        new Response("<h1>Bad gateway</h1>", { status: 502, statusText: "Bad Gateway" }),
    });
    await expect(api("/rates", cnbRatesSchema)).rejects.toMatchObject({
      status: 502,
      message: "Bad Gateway",
      issues: [],
    });
  });

  it("names the status when there is no status text either (HTTP/2)", async () => {
    stubFetch({ "GET /api/rates": () => Response.json({ error: "nope" }, { status: 503 }) });
    await expect(api("/rates", cnbRatesSchema)).rejects.toMatchObject({
      status: 503,
      message: "Request failed with status 503",
    });
  });
});

describe("api: timeout", () => {
  it("gives up on a request that is never answered, with a readable error", async () => {
    stubFetch({ "POST /api/orders": hang });
    const request = api("/orders", orderSchema, { method: "POST", body: {}, timeoutMs: 20 });
    await expect(request).rejects.toThrow(ApiTimeoutError);
    await expect(request).rejects.toThrow("The server did not answer in time.");
  });

  it("also gives up when the body stops coming after the headers", async () => {
    stubFetch({
      "GET /api/products": (_url, { signal }) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"items":['));
              signal?.addEventListener("abort", () => controller.error(signal.reason));
            },
          }),
        ),
    });
    await expect(api("/products", productPageSchema, { timeoutMs: 20 })).rejects.toThrow(ApiTimeoutError);
  });

  it("waits 15 s by default and hands the timeout signal to fetch", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = stubFetch({ "GET /api/products": () => Response.json(page) });

    await api("/products", productPageSchema);

    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products",
      expect.objectContaining({ signal: timeout.mock.results[0]?.value }),
    );
  });

  it("does not report other failures as a timeout", async () => {
    stubFetch({
      "GET /api/products": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(api("/products", productPageSchema, { timeoutMs: 1000 })).rejects.toThrow(TypeError);
  });

  it("stops when the caller cancels, and does not call that a timeout", async () => {
    const fetchMock = stubFetch({ "GET /api/products": hang });
    const controller = new AbortController();

    const request = api("/products", productPageSchema, { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await expect(request).rejects.not.toBeInstanceOf(ApiTimeoutError);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal?.aborted).toBe(true);
  });
});
