# Wally

A personal digital whiteboard for managing to-dos as movable notes — built for Finlex. Notes live on a free canvas and can be organized by **Horizont** (Heute / Diese Woche / Später), **Priorität** (Hoch / Mittel / Niedrig), or positioned **Frei**, with a synced list view, sharing, and full note detail (subtasks, tags, reference, history). See [`docs/SPEC.md`](docs/SPEC.md) for the full product spec.

## Stack

pnpm workspaces + Turborepo monorepo:

```
apps/api          Fastify + Prisma + PostgreSQL — REST API, Firebase-token auth
apps/web          Vite + React 19 + TanStack Query + shadcn/ui + dnd-kit
packages/shared   Zod schemas, enums, constants shared by both apps
packages/config   Shared eslint/tsconfig/prettier
```

Auth is Firebase Authentication (email/password + Google). Everything runs in Docker locally; the intended deploy target is Google Cloud Run + Cloud SQL. See [`docs/SETUP.md`](docs/SETUP.md) for the conventions this repo follows and [`docs/RULE.md`](docs/RULE.md) for working rules.

## Prerequisites

- Docker + Docker Compose
- `make`
- A Firebase project (see [Firebase setup](#firebase-setup) below) — the app won't start without one

Nothing else needs to be installed on the host; all commands run inside Docker.

## Getting started

```bash
cp .env.example .env
# fill in the Firebase values in .env — see "Firebase setup" below

make up        # builds and starts db, api, web
make migrate   # applies the database schema
make seed      # loads demo data (a sample board, notes, and members)
```

- Web: http://localhost:5174 *(not 5173 — see [Ports](#ports))*
- API: http://localhost:4000

## Firebase setup

The backend verifies Firebase ID tokens; the frontend signs users in with the Firebase Web SDK. You need one Firebase project supplying both:

1. **Enable sign-in methods**: Firebase console → Authentication → Sign-in method → enable Email/Password and Google.
2. **Web app config** (`VITE_FIREBASE_*` in `.env`): Project Settings → General → Your apps → Web app → copy `apiKey`, `authDomain`, `projectId`, `appId`.
3. **Service account** (`FIREBASE_*` in `.env`): Project Settings → Service accounts → Generate new private key → copy `project_id`, `client_email`, `private_key` (keep the `\n` escapes as-is).

If your Google Cloud org blocks service-account key creation (`iam.disableServiceAccountKeyCreation`), you'll need an org admin to grant a project-level exception on **both** the legacy and managed versions of that constraint (Organization Policies in the Cloud Console) — they're enforced independently.

## Commands

| Command | Purpose |
| --- | --- |
| `make up` | Build and start db, api, web |
| `make down` | Stop and remove containers |
| `make logs` | Follow logs of all services |
| `make test` | Run all tests (backend + frontend, via Turbo) |
| `make lint` | Run lint across the workspace |
| `make typecheck` | Type-check across the workspace |
| `make migrate` | Apply database migrations |
| `make migrate-dev` | Create a new migration from schema changes |
| `make seed` | Load development seed data (idempotent) |
| `make e2e` | Run Playwright end-to-end tests (needs `make up` first) |

## Ports

Host port `5173` and `5432` were already in use by other local projects when this was built, so:
- Web is published on **`5174`** (container still runs Vite on 5173 internally).
- Postgres publishes no host port at all — reach it via `docker compose exec db psql -U wally` if needed.

Adjust `docker-compose.yml` if your environment doesn't have that conflict.

## Testing

- Backend: Vitest — unit tests for business logic, integration tests against the real Postgres in compose.
- Frontend: Vitest + React Testing Library for stateful components; Playwright for end-to-end flows (`apps/web/e2e/`, see its `README.md` for what each spec needs).

`make test` runs everything non-interactively. Integration/e2e tests need the db (and for e2e, the full stack) up.

## Deploying

Each app's `Dockerfile` has a `prod` target (multi-stage, minimal runtime) intended for Google Cloud Run, with Cloud SQL for PostgreSQL as the managed database. No deploy automation exists yet — that's the next step once this is ready to ship.
