# Wally

A personal digital whiteboard for managing to-dos as movable notes. Notes live on a free canvas and can be organized by **horizon** (Today / This week / Later), **priority** (High / Medium / Low), or positioned **freely**, with a synced list view, sharing, and full note detail (subtasks, tags, reference, history). See [`docs/SPEC.md`](docs/SPEC.md) for the full product spec.

## Stack

pnpm workspaces + Turborepo monorepo:

```
apps/api          Fastify + Cloud Firestore — REST API and MCP endpoint, Auth0 or Firebase-token auth
apps/web          Vite + React 19 + TanStack Query + shadcn/ui + dnd-kit
packages/shared   Zod schemas, enums, constants shared by both apps
packages/config   Shared eslint/tsconfig/prettier
```

In production, the API runs on Cloud Run (europe-west1) at `api.wally.luminull.com`, the web app on Firebase Hosting at `wally.luminull.com`, and all data in **Cloud Firestore** (database `wally`). **Auth0** signs users in, for the web app and for MCP clients such as ChatGPT ([`docs/AUTH0.md`](docs/AUTH0.md)); Firebase Authentication remains only as a rollback path and is the local default. Only the API talks to Firestore — it uses the Admin SDK, and the web app reaches data solely through the REST API, so the whiteboard role checks always apply. Everything runs in Docker locally against the Firestore emulator. The decided move to Supabase and Cloudflare is planned in [`docs/rfcs/0011-platform-migration.md`](docs/rfcs/0011-platform-migration.md); nothing is migrated yet. Start at [`docs/README.md`](docs/README.md) for the architecture overview and the decision records. See [`docs/SETUP.md`](docs/SETUP.md) for the conventions and working rules this repo follows, and [`docs/GDPR.md`](docs/GDPR.md) for what the app does with personal data and which obligations are still open.

## Prerequisites

- Docker + Docker Compose
- `make`
- A Firebase project (see [Firebase setup](#firebase-setup) below) — the app won't start without one

Nothing else needs to be installed on the host; all commands run inside Docker.

## Getting started

```bash
cp .env.example .env
# fill in the Firebase values in .env — see "Firebase setup" below

make up        # builds and starts the Firestore emulator, api, web
make seed      # loads demo data (a sample board, notes, and members)
```

- Web: http://localhost:5174 _(not 5173 — see [Ports](#ports))_
- API: http://localhost:4000
- Firestore emulator UI: http://localhost:4001 — browse the local data

There is no migration step: Firestore is schemaless. Document shapes live in
[`apps/api/src/lib/db/types.ts`](apps/api/src/lib/db/types.ts) and composite indexes in
[`firestore.indexes.json`](firestore.indexes.json).

The emulator keeps its data in memory, so anything you created locally is gone once its
container is recreated (`make down`, or a rebuild). Run `make seed` again to get the demo
board back — it's idempotent, and it keeps the same share-link token across runs.

## Firebase setup

The backend verifies Firebase ID tokens; the frontend signs users in with the Firebase Web SDK. You need one Firebase project supplying both:

1. **Enable sign-in methods**: Firebase console → Authentication → Sign-in method → enable Email/Password and Google.
1. **Create the Firestore database**: Firebase console → Firestore Database → Create database. Only needed for a real deployment — local development uses the emulator and never touches it.
1. **Web app config** (`VITE_FIREBASE_*` in `.env`): Project Settings → General → Your apps → Web app → copy `apiKey`, `authDomain`, `projectId`, `appId`.
1. **Service account** (`FIREBASE_*` in `.env`): Project Settings → Service accounts → Generate new private key → copy `project_id`, `client_email`, `private_key` (keep the `\n` escapes as-is).

If your Google Cloud org blocks service-account key creation (`iam.disableServiceAccountKeyCreation`), you'll need an org admin to grant a project-level exception on **both** the legacy and managed versions of that constraint (Organization Policies in the Cloud Console) — they're enforced independently.

## Commands

| Command          | Purpose                                                 |
| ---------------- | ------------------------------------------------------- |
| `make up`        | Build and start the Firestore emulator, api, web        |
| `make down`      | Stop and remove containers                              |
| `make logs`      | Follow logs of all services                             |
| `make test`      | Run all tests (backend + frontend, via Turbo)           |
| `make lint`      | Run lint across the workspace                           |
| `make typecheck` | Type-check across the workspace                         |
| `make seed`      | Load development seed data (idempotent)                 |
| `make e2e`       | Run Playwright end-to-end tests (needs `make up` first) |

## Ports

Host port `5173` was already in use by another local project when this was built, so:

- Web is published on **`5174`** (container still runs Vite on 5173 internally).
- The Firestore emulator publishes **`4001`** (Emulator UI), **`8080`** (Firestore data) and **`9150`** (the UI's request-monitor websocket). All three are needed: the Emulator UI runs in your browser, so it reaches the emulator over the host rather than the compose network — publishing only 4001 gets you a blank page. The API container talks to it as `firestore:8080` regardless.

Adjust `docker-compose.yml` if your environment doesn't have that conflict.

## Testing

- Backend: Vitest — unit tests for business logic, integration tests against the Firestore emulator in compose. Each test file uses its own emulator project id, which keeps them isolated and lets them run in parallel.
- Frontend: Vitest + React Testing Library for stateful components; Playwright for end-to-end flows (`apps/web/e2e/`, see its `README.md` for what each spec needs).

`make test` runs everything non-interactively and starts the emulator on its own; e2e needs the full stack up.

## Deploying

Each app's `Dockerfile` has a `prod` target (multi-stage, minimal runtime) intended for Google Cloud Run. The database is the Firebase project's own Cloud Firestore — there is nothing to provision and nothing billed while the app is idle, which is why it was chosen over a managed Postgres instance.

Two things must be deployed alongside the code, with the Firebase CLI:

```bash
firebase deploy --only firestore:indexes,firestore:rules
```

- **`firestore.indexes.json`** — the emulator never enforces indexes and creates them on the fly, so a missing one only shows up in production as a `FAILED_PRECONDITION` error.
- **`firestore.rules`** — denies all direct client access by design. Every legitimate read goes through the API's Admin SDK, which bypasses rules.

The Cloud Run service reaches Firestore through its runtime service account — there is no connection string to configure. Deployment is automated. Every pull request runs lint, formatting, type checks, the Vitest suites against a Firestore emulator, a production build and the Playwright end-to-end suite against a full Docker Compose stack. Pushing a `v*` tag deploys to production, behind a required approval on the `production` GitHub Environment: Firestore rules and indexes, then the API to Cloud Run as a no-traffic revision that is smoke-tested before traffic moves, then the web bundle to Firebase Hosting, then a read-only smoke test of the live site — rolling back automatically if that fails. GitHub authenticates to Google Cloud through Workload Identity Federation, so no service-account key exists anywhere. The workflows are in [`.github/workflows/`](.github/workflows/); the manual commands remain in [`docs/DEPLOY.md`](docs/DEPLOY.md) as the break-glass path, and one-time cloud setup lives in [`scripts/bootstrap-gcp-cicd.sh`](scripts/bootstrap-gcp-cicd.sh).
