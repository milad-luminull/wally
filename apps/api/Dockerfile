# Build context is the MONOREPO ROOT (needs packages/shared, packages/config, and the
# root lockfile) — build with:  docker build -f apps/api/Dockerfile .
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# -----------------------------------------------------------------------------------
# dev — hot reload via `tsx watch`. Expects the monorepo root bind-mounted as a volume
# by docker-compose over /app (node_modules installed here at build time is what
# actually runs; the bind mount overlays source changes on top of it).
# -----------------------------------------------------------------------------------
FROM base AS dev
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/config/package.json packages/config/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
EXPOSE 4000
CMD ["pnpm", "--filter", "@wally/api", "dev"]

# -----------------------------------------------------------------------------------
# build — installs the full workspace and compiles @wally/api to plain JS. `pnpm deploy`
# then assembles a self-contained, prod-only dependency tree for just @wally/api
# (including its workspace deps' files) so the final stage doesn't need pnpm/the
# workspace at all.
# -----------------------------------------------------------------------------------
FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @wally/shared build
RUN pnpm --filter @wally/api build
RUN pnpm deploy --filter=@wally/api --prod /app/deploy/api

# @wally/shared's package.json points `main`/`types`/`exports` at its raw src/index.ts —
# fine for tsx and Vite in dev, which transform TypeScript themselves regardless of
# node_modules, but plain `node dist/server.js` in the prod stage below uses Node's native
# type-stripping, which refuses to strip types for anything under node_modules. Rather than
# change the workspace package.json (and break the dev import path), patch just the
# deployed copy to point at the dist/ this stage already built above.
RUN node -e "\
  const fs = require('node:fs'); \
  const path = '/app/deploy/api/node_modules/@wally/shared/package.json'; \
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8')); \
  pkg.main = './dist/index.js'; \
  pkg.types = './dist/index.d.ts'; \
  pkg.exports = { '.': './dist/index.js' }; \
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2)); \
"

# -----------------------------------------------------------------------------------
# prod — minimal runtime: compiled dist/ and production dependencies only. There is no
# schema or migration step to ship: Firestore is schemaless, and the composite indexes
# live in the repo root's firestore.indexes.json, deployed with the Firebase CLI rather
# than by the server at boot.
# -----------------------------------------------------------------------------------
FROM node:22-slim AS prod
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/deploy/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./package.json
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/server.js"]
