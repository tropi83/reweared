# syntax=docker/dockerfile:1
# Two images from the repository root (docker compose builds both):
#   --target server  → the api (and, from phase 2, the worker): node dist/api.js / node dist/migrate.js
#   --target web     → Caddy serving the web bundle and proxying /api to the api
# Base images pinned on 2026-10-12 (Docker Hub): node 22.23.3-alpine3.24, caddy 2.11.7-alpine.

FROM node:22.23.3-alpine3.24 AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate
WORKDIR /repo

# Dependencies: the lockfile alone first, so this layer is reused until it changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile

FROM deps AS server-build
RUN pnpm --filter @aiv/server build \
 && pnpm --filter @aiv/server deploy --prod --legacy /out \
 && cp -r apps/server/dist apps/server/drizzle /out/

FROM deps AS web-build
# The bundle Caddy serves is the account version of the app, on the same origin as the API (phase 3).
ARG VITE_API_ORIGIN=/
ENV VITE_API_ORIGIN=${VITE_API_ORIGIN}
RUN pnpm build

FROM node:22.23.3-alpine3.24 AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=server-build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/v1/health >/dev/null || exit 1
CMD ["node", "dist/api.js"]

FROM caddy:2.11.7-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /repo/dist /srv/web
