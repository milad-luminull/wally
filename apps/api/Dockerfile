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
# build — installs the full workspace, generates the Prisma client, and compiles
# @wally/api to plain JS. `pnpm deploy` then assembles a self-contained, prod-only
# dependency tree for just @wally/api (including its workspace deps' files) so the
# final stage doesn't need pnpm/the workspace at all.
# -----------------------------------------------------------------------------------
FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @wally/api db:generate
RUN pnpm --filter @wally/api build
RUN pnpm deploy --filter=@wally/api --prod /app/deploy/api

# -----------------------------------------------------------------------------------
# prod — minimal runtime: compiled dist/, prisma/ (schema + migrations, for
# `prisma migrate deploy`), and only production dependencies.
#
# NOTE: @wally/shared has no build step (it's consumed as TypeScript source directly,
# per its package.json `main`/`types` pointing at src/index.ts) — `node dist/server.js`
# importing it relies on Node 22's native TypeScript type-stripping. That's stable and
# on-by-default from Node ~22.18/23.6 onward; node:22-slim should have it by the time
# this is built, but if your pulled base image predates that, add
# `--experimental-strip-types` to the CMD below (or add a real build step to
# packages/shared — flagged separately as a possible gap in that package).
# -----------------------------------------------------------------------------------
FROM node:22-slim AS prod
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/deploy/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/apps/api/package.json ./package.json
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/server.js"]
