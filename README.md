# Wally

A personal digital whiteboard for managing to-dos as movable notes. Notes live on a free canvas and can be organized by **horizon** (Today / This week / Later), **priority** (High / Medium / Low), or positioned **freely**, with a synced list view, sharing, and full note detail (subtasks, tags, reference, history). See [`docs/SPEC.md`](docs/SPEC.md) for the full product spec.

## Stack

pnpm workspaces + Turborepo monorepo:

```
apps/api          Fastify + PostgreSQL (Drizzle) — REST API and MCP endpoint, Auth0 access-token auth
apps/web          Vite + React 19 + TanStack Query + shadcn/ui + dnd-kit
packages/shared   Zod schemas, enums, constants shared by both apps
packages/config   Shared eslint/tsconfig/prettier
```

In production, the API runs on Cloud Run (europe-west1) at `api.wally.luminull.com` and the web app is served at `wally.luminull.com`. The API reads and writes only **PostgreSQL**, through Drizzle, in a Supabase project in Ireland ([ADR-0020](docs/adr/ADR-0020-supabase-postgres-through-the-api-with-drizzle.md)); production has run it since v0.12.0 (2026-11-01). Cloudflare serves both hostnames since v0.13.0 (2026-11-01) ([ADR-0022](docs/adr/ADR-0022-cloudflare-pages-and-api-proxy.md)): the web app as a Worker serving static files, and the API behind a Worker that forwards every request to Cloud Run unchanged. The release deploys both Workers ([`docs/DEPLOY.md`](docs/DEPLOY.md)). **Auth0** signs users in everywhere, in production, local development and CI, for the web app and for MCP clients such as ChatGPT ([`docs/AUTH0.md`](docs/AUTH0.md)). Wally no longer uses Firebase ([`docs/DEPLOY.md`](docs/DEPLOY.md#firebase-retired)). Only the API talks to the database, and the web app reaches data solely through the REST API, so the whiteboard role checks always apply. Everything runs in Docker locally against a PostgreSQL container. The decided move to Supabase and Cloudflare is planned in [`docs/rfcs/RFC-0011-platform-migration.md`](docs/rfcs/RFC-0011-platform-migration.md); workstreams 1 and 2 (the API on PostgreSQL) and 4 (the Cloudflare edge) are live, Firebase is gone from the code (workstream 6, part 1), and the rest has not started. Start at [`docs/README.md`](docs/README.md) for the architecture overview and the decision records. See [`docs/SETUP.md`](docs/SETUP.md) for the conventions and working rules this repo follows, and [`docs/GDPR.md`](docs/GDPR.md) for what the app does with personal data and which obligations are still open.

## Prerequisites

- Docker + Docker Compose
- `make`
- An Auth0 account to sign in with (see [Sign-in](#sign-in) below)

Nothing else needs to be installed on the host to run the stack and the Vitest suites; those commands run inside Docker. `make format` runs on the host and needs Node and pnpm.

## Getting started

```bash
cp .env.example .env

make up        # builds and starts PostgreSQL, applies the migrations, starts api and web
make seed      # loads demo data (a sample board, notes, and members)
```

- Web: http://localhost:5174 _(not 5173 — see [Ports](#ports))_
- API: http://localhost:4000
- Database: `docker compose exec postgres psql -U postgres -h localhost` (no published port)

The schema is in [`apps/api/src/lib/postgres/schema/`](apps/api/src/lib/postgres/schema/)
and its SQL migrations in [`apps/api/drizzle/`](apps/api/drizzle/). The one-shot `migrate`
service applies them on every `make up`, before the API starts; changing the schema is
described in [`docs/SETUP.md`](docs/SETUP.md#docker).

The database lives in the `postgres-data` volume, so it survives `make down`.
`docker compose down -v` deletes it; `make up && make seed` then gives a fresh database with
the demo board. `make seed` is idempotent and keeps the same share-link token across runs.

## Sign-in

Locally, as in production, you sign in through Auth0's hosted login page with Google or an email and password. Nothing needs configuring: the web app uses Wally's public Auth0 SPA client, whose allowed callbacks include `http://localhost:5174/login`, and `.env.example` turns on `AUTH0_SIGNUP_ENABLED`, so your first sign-in creates your account in the local database. Two things differ from production ([`docs/AUTH0.md`](docs/AUTH0.md)):

- On `http://localhost`, Auth0 asks you to confirm the login again after a page reload.
- A second copy of the web app on another port cannot sign in until that port is registered in the Auth0 SPA client.

## Commands

| Command          | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `make up`        | Build and start PostgreSQL, the migrations, api, web |
| `make down`      | Stop and remove containers                           |
| `make logs`      | Follow logs of all services                          |
| `make test`      | Run all tests (backend + frontend, via Turbo)        |
| `make lint`      | Run lint across the workspace                        |
| `make typecheck` | Type-check across the workspace                      |
| `make seed`      | Load development seed data (idempotent)              |

## Ports

Host port `5173` was already in use by another local project when this was built, so:

- Web is published on **`5174`** (container still runs Vite on 5173 internally).
- PostgreSQL publishes no port, so several compose projects (worktrees) can run side by side. The API reaches it as `postgres:5432` on the compose network.

Adjust `docker-compose.yml` if your environment doesn't have that conflict.

## Testing

- Backend: Vitest — unit tests for business logic, integration tests against the compose PostgreSQL. Each test file clones its own database from a template migrated once per run ([ADR-0025](docs/adr/ADR-0025-local-postgres-and-per-file-test-databases.md)), which keeps them isolated and lets them run in parallel.
- Frontend: Vitest + React Testing Library for stateful components; Playwright for end-to-end flows (`apps/web/e2e/`, see its `README.md` for what each spec needs).

`make test` runs everything non-interactively inside the api container and starts PostgreSQL on its own. The Playwright suite runs in CI only, because Auth0 asks to confirm the login after every reload on a plain `localhost` origin ([`apps/web/e2e/README.md`](apps/web/e2e/README.md)). CI is the proof that E2E passes.

## Deploying

The API's `Dockerfile` `prod` target (multi-stage, minimal runtime) is the image Cloud Run runs; it carries the SQL migrations in `/app/drizzle`. The web app is a static bundle served by the `wally-web` Worker ([`apps/web/wrangler.jsonc`](apps/web/wrangler.jsonc)); its Dockerfile's `prod` target (nginx) is not deployed. The `wally-api-proxy` Worker ([`apps/api-proxy`](apps/api-proxy)) gives the API its hostname. The database is a Supabase PostgreSQL project on the Free plan ([ADR-0020](docs/adr/ADR-0020-supabase-postgres-through-the-api-with-drizzle.md)), reached through its transaction pooler.

Cloud Run gets the connection string as `DATABASE_URL` from Secret Manager (secret `wally-database-url`); it carries the password, so it is never a plain variable. Deployment is automated. Every pull request runs lint, formatting, type checks, the Vitest suites against a PostgreSQL service, a production build and the Playwright end-to-end suite against a full Docker Compose stack. Pushing a `v*` tag deploys to production, behind a required approval on the `production` GitHub Environment: the database migrations, run from the image being deployed, then the API to Cloud Run as a no-traffic revision that is smoke-tested before traffic moves, then both Workers as versions that are smoke-tested on their preview URLs before they are deployed, then a read-only smoke test of the live site — rolling back automatically if that fails. GitHub authenticates to Google Cloud through Workload Identity Federation, so no service-account key exists anywhere. The workflows are in [`.github/workflows/`](.github/workflows/); the manual commands remain in [`docs/DEPLOY.md`](docs/DEPLOY.md) as the break-glass path, and one-time cloud setup lives in [`scripts/bootstrap-gcp-cicd.sh`](scripts/bootstrap-gcp-cicd.sh).

**The database half of the release has never run.** It needs the Supabase project, the secret, and `roles/secretmanager.secretAccessor` on it for both the deploy identity and the `wally-api` service account; none exists yet. Migrations must stay backward compatible with the revision still serving, because a rollback reverts the API, never the schema. See [`docs/DEPLOY.md`](docs/DEPLOY.md), sections 4, 7 and 13.
