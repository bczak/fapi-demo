import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In docker-compose the API is reachable as http://api:3000.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";
// Extra host names the dev server answers to (e.g. a tunnel), comma separated: ALLOWED_HOSTS=my-box,.ts.net
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts,
    proxy: { "/api": apiTarget },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // A test that replaces fetch or crypto must not leak it into the next one.
    unstubGlobals: true,
    clearMocks: true,
  },
});
