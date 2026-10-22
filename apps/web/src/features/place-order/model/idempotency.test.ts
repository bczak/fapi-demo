import { createOrderSchema } from "@fapi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTEMPT_STORAGE_KEY,
  completeAttempt,
  fingerprintOf,
  idempotencyKeyFor,
  type OrderSnapshot,
  randomUuid,
} from "./idempotency";

const snapshot: OrderSnapshot = {
  customer: {
    firstName: "Jana",
    lastName: "Nováková",
    email: "jana@example.com",
    phone: "+420 123 456 789",
    street: "Dlouhá 1",
    city: "Praha",
    zip: "110 00",
  },
  currency: "CZK",
  items: [
    { productId: 1, quantity: 2 },
    { productId: 2, quantity: 1 },
  ],
};

const isUuid = (value: string) => createOrderSchema.shape.idempotencyKey.safeParse(value).success;

describe("idempotencyKeyFor", () => {
  beforeEach(completeAttempt);

  it("creates a valid uuid", () => {
    expect(isUuid(idempotencyKeyFor(snapshot))).toBe(true);
  });

  it("reuses the key for a retry of the same snapshot", () => {
    expect(idempotencyKeyFor({ ...snapshot })).toBe(idempotencyKeyFor(snapshot));
  });

  it("reuses the key when the same items come in another order", () => {
    const reversed = { ...snapshot, items: [...snapshot.items].reverse() };
    expect(idempotencyKeyFor(reversed)).toBe(idempotencyKeyFor(snapshot));
  });

  it("reuses the key when the customer fields come in another order", () => {
    const { firstName, lastName, email, phone, street, city, zip } = snapshot.customer;
    const reordered: OrderSnapshot = {
      ...snapshot,
      customer: { zip, city, street, phone, email, lastName, firstName },
    };
    expect(Object.keys(reordered.customer)).not.toEqual(Object.keys(snapshot.customer));
    expect(idempotencyKeyFor(reordered)).toBe(idempotencyKeyFor(snapshot));
  });

  it.each<[string, OrderSnapshot]>([
    [
      "a quantity changes",
      {
        ...snapshot,
        items: [
          { productId: 1, quantity: 3 },
          { productId: 2, quantity: 1 },
        ],
      },
    ],
    ["a product is removed", { ...snapshot, items: [{ productId: 1, quantity: 2 }] }],
    ["the currency changes", { ...snapshot, currency: "EUR" }],
    ["the customer changes", { ...snapshot, customer: { ...snapshot.customer, street: "Krátká 2" } }],
  ])("gets a new key when %s", (_, changed) => {
    expect(idempotencyKeyFor(changed)).not.toBe(idempotencyKeyFor(snapshot));
  });

  it("gets a new key after the order was placed", () => {
    const first = idempotencyKeyFor(snapshot);
    completeAttempt();
    expect(idempotencyKeyFor(snapshot)).not.toBe(first);
  });

  it("goes back to a new key when an earlier snapshot returns after a change", () => {
    const first = idempotencyKeyFor(snapshot);
    idempotencyKeyFor({ ...snapshot, currency: "USD" });
    expect(idempotencyKeyFor(snapshot)).not.toBe(first);
  });
});

describe("idempotencyKeyFor across a page reload", () => {
  beforeEach(completeAttempt);
  afterEach(() => vi.restoreAllMocks());

  /** A fresh copy of the module, as after a reload: only sessionStorage carries over. */
  const reload = () => {
    vi.resetModules();
    return import("./idempotency");
  };

  it("keeps the key of an attempt whose response was lost", async () => {
    const first = idempotencyKeyFor(snapshot);
    const reloaded = await reload();
    expect(reloaded.idempotencyKeyFor(snapshot)).toBe(first);
  });

  it("still gets a new key for another snapshot after the reload", async () => {
    const first = idempotencyKeyFor(snapshot);
    const reloaded = await reload();
    expect(reloaded.idempotencyKeyFor({ ...snapshot, currency: "EUR" })).not.toBe(first);
  });

  it("forgets the attempt, in storage too, once the order was placed", async () => {
    const first = idempotencyKeyFor(snapshot);
    completeAttempt();
    expect(sessionStorage.getItem(ATTEMPT_STORAGE_KEY)).toBeNull();
    const reloaded = await reload();
    expect(reloaded.idempotencyKeyFor(snapshot)).not.toBe(first);
  });

  it.each([
    ["not JSON", "{not json"],
    ["not an attempt", JSON.stringify(["a", "b"])],
    ["an invalid key", JSON.stringify({ fingerprint: fingerprintOf(snapshot), key: "abc" })],
    [
      "a nil key",
      JSON.stringify({ fingerprint: fingerprintOf(snapshot), key: "00000000-0000-0000-0000-000000000000" }),
    ],
  ])("starts a new attempt when the stored one is %s", async (_, stored) => {
    sessionStorage.setItem(ATTEMPT_STORAGE_KEY, stored);
    const reloaded = await reload();
    const key = reloaded.idempotencyKeyFor(snapshot);
    expect(isUuid(key)).toBe(true);
    expect(reloaded.idempotencyKeyFor(snapshot)).toBe(key);
  });

  it("works from memory when sessionStorage is blocked", async () => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);
    const reloaded = await reload();

    const first = reloaded.idempotencyKeyFor(snapshot);
    expect(isUuid(first)).toBe(true);
    expect(reloaded.idempotencyKeyFor(snapshot)).toBe(first);
    reloaded.completeAttempt();
    expect(reloaded.idempotencyKeyFor(snapshot)).not.toBe(first);
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });
});

describe("fingerprintOf", () => {
  it("differs for different customers with the same lines", () => {
    const other = { ...snapshot, customer: { ...snapshot.customer, email: "other@example.com" } };
    expect(fingerprintOf(other)).not.toBe(fingerprintOf(snapshot));
  });
});

describe("randomUuid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses crypto.randomUUID when it exists", () => {
    expect(isUuid(randomUuid())).toBe(true);
  });

  it("still makes a valid v4 uuid where crypto.randomUUID is missing (plain-http origins)", () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const uuids = Array.from({ length: 200 }, randomUuid);
    expect(uuids.every(isUuid)).toBe(true);
    expect(uuids.every((u) => /^.{14}4.{3}-[89ab]/.test(u))).toBe(true);
    expect(new Set(uuids).size).toBe(uuids.length);
  });
});
