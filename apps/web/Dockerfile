# Build context is the repo root: docker build -f apps/web/Dockerfile .
# apps/web depends on packages/shared (workspace:*) and packages/config, so the whole
# workspace needs to be in the build context, not just apps/web.

FROM node:22-slim AS base
# Pin pnpm exactly as apps/api/Dockerfile does; bare `corepack enable` resolves the version
# from the packageManager field at build time, which is a network dependency and can drift.
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ---------------------------------------------------------------------------
# dev — hot-reload dev server, run inside docker-compose. docker-compose is expected to
# bind-mount the repo over this image and use an anonymous volume for
# /repo/**/node_modules so the bind mount doesn't shadow the deps installed below.
# ---------------------------------------------------------------------------
FROM base AS dev
COPY . .
RUN pnpm install --frozen-lockfile
WORKDIR /repo/apps/web
EXPOSE 5173
# `dev` (package.json) already includes --host — Vite must bind 0.0.0.0, not just
# localhost, for the compose port mapping to actually reach it from the host.
CMD ["pnpm", "--filter", "@wally/web", "dev"]

# ---------------------------------------------------------------------------
# build — compiles the static production bundle. packages/shared ships its TypeScript
# source directly (package.json "main" points at src/index.ts), so Vite consumes it
# straight from source — no separate shared-package build step needed.
# ---------------------------------------------------------------------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @wally/web build

# ---------------------------------------------------------------------------
# prod — minimal static file server. nginx:alpine over a Node static-file server: the
# output is a plain SPA bundle (HTML/JS/CSS, no server-side rendering or Node runtime
# needed to serve it), and nginx is smaller, needs no extra npm package, and its
# try_files SPA-fallback + immutable-asset caching are both one-line config instead of
# hand-rolled Node routing.
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS prod
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
