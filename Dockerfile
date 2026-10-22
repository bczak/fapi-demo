# Production image: one service. The API serves /api/* and the built web app (with SPA fallback),
# so there is one URL, no CORS and no proxy. SQLite lives on a volume mounted at /data.

FROM node:22-bookworm-slim AS build
COPY --from=oven/bun:1.4.3 /usr/local/bin/bun /usr/local/bin/bun
# better-sqlite3 compiles from source when no prebuilt binary is available.
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g node-gyp
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run --filter @fapi/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/shop.db \
    WEB_DIST=/app/apps/web/dist
WORKDIR /app
# Same base image as the build stage, so the compiled native SQLite addon matches.
COPY --from=build /app /app
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
