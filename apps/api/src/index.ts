import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { config } from "./config";
import { createDb } from "./db/client";
import { seedProducts } from "./db/seed";
import { forwardedAddress, remoteAddress } from "./middleware/client-key";
import { createRatesService } from "./modules/rates/rates.service";

const db = createDb(config.dbPath);
seedProducts(db);

const app = createApp({
  db,
  getRates: createRatesService(),
  admin: { user: config.adminUser, password: config.adminPassword },
  clientKey: config.proxyHops > 0 ? forwardedAddress(config.proxyHops) : remoteAddress,
  webDist: config.webDist,
  log: true,
});

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, ({ port }) => {
  console.log(`API listening on http://localhost:${port}`);
});
