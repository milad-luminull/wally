# ADR-0009: Local dev and CI run in Docker Compose against the Firestore emulator, with real Firebase Auth

- **Status:** accepted; partly superseded by [ADR-0025](ADR-0025-local-postgres-and-per-file-test-databases.md) (local PostgreSQL)
- **Date:** 2026-09-18
- **Deciders:** Milad Rezazadeh

## Context and problem statement

A new developer should be able to run Wally from an empty checkout with one command and without installing Node, pnpm, Java or the Firebase CLI on their machine. Tests must run against a real Firestore implementation, not a mock, and must be able to run in parallel. Where does the stack run locally and in CI, and which Firebase services are emulated?

## Considered options

1. **Docker Compose with an emulator container, real Firebase Authentication, `make` as the entry point:** good, because the host needs only Docker and `make`, and the same compose file serves CI; bad, because local development still needs a real Firebase project and credentials.
2. **Host installs, optionally wrapped in a devcontainer:** good, because faster feedback without bind mounts; bad, because every developer's toolchain differs, and the emulator needs a JRE on top.
3. **Emulate Authentication as well:** good, because no credentials at all; bad, because sign-in with Google and ID-token verification would then be tested against a fake, and the e2e suite would not prove the real flow.

## Decision outcome

Chosen option: **Docker Compose, Firestore emulated, Auth real.**

- [`docker-compose.yml`](../../docker-compose.yml) runs `firestore` (built from [`infra/firebase-emulator.Dockerfile`](../../infra/firebase-emulator.Dockerfile)), `api` and `web`, with the repository bind-mounted for hot reload. [`Makefile`](../../Makefile) is the only interface; `make up` is the one command a new developer needs.
- Compose sets `FIRESTORE_EMULATOR_HOST` on the API; the Admin SDK routes Firestore traffic there and boots without a credential (`getFirebaseApp` in [`apps/api/src/lib/firebase-app.ts`](../../apps/api/src/lib/firebase-app.ts)). Firebase Auth is not redirected; ID tokens are verified against the real project, which is why the `FIREBASE_*` values in `.env` matter locally.
- Each API test file creates its own emulator project through `createNamedDb` in [`apps/api/src/lib/db/client.ts`](../../apps/api/src/lib/db/client.ts); `singleProjectMode: false` in [`firebase.json`](../../firebase.json) allows it. Files are isolated and run in parallel.
- `loadEnv` in [`apps/api/src/env.ts`](../../apps/api/src/env.ts) refuses to start a production process with an emulator host set.
- CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) runs the unit and integration suites under `firebase emulators:exec`, and the Playwright suite on the full compose stack, with a guard that fails if the suite was vacuously green.

### Consequences

- Good: `make up` from an empty checkout, and the same stack in CI.
- Good: integration tests hit real Firestore semantics, including transactions and collection-group queries.
- Bad: local development and CI need a real Firebase project, a test user and credentials. A pull request from a fork cannot reach them, so its E2E job is skipped and the gate fails on purpose.
- Bad: the emulator holds data in memory. `make down` or a rebuild loses it; `make seed` restores the demo board.
- Bad: the emulator does not enforce composite indexes, so a missing index first fails in production (ADR-0003).
- Neutral: a new dependency needs a host install, a container install and an image rebuild before `make test` sees it.

### Confirmation

CI runs every suite on every pull request. The `E2E gate` job requires the E2E job to have actually run.

## More information

- Commands, ports and the Firebase setup: root [`README.md`](../../README.md).
- Test policy: [`SETUP.md`](../SETUP.md), "Tests". What each E2E spec needs: [`apps/web/e2e/README.md`](../../apps/web/e2e/README.md).
