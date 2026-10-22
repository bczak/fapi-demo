import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// The stores persist to the (jsdom) web storage; nothing may carry over to the next test.
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
