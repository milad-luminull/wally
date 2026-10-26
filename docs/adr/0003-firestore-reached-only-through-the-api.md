# ADR-0003: Cloud Firestore as the only data store, reached only through the API

- **Status:** superseded by [ADR-0020](0020-supabase-postgres-through-the-api-with-drizzle.md)
- **Date:** 2026-09-20
- **Deciders:** Milad Rezazadeh

## Context and problem statement

The first build of Wally (commit `66bd226d`) ran Fastify with Prisma on PostgreSQL. A managed Postgres instance bills every hour whether or not anyone is using the app, and Wally is a personal whiteboard with long idle stretches. The project already depended on Firebase for authentication. Commit `e1f8e21e` replaced Prisma with the Firebase Admin SDK and Cloud Firestore; no commit message records why. Which data store should Wally use, and who is allowed to talk to it?

## Decision drivers

- Nothing billed while idle; scale to zero like the rest of the stack.
- One Google Cloud project for auth, data and hosting.
- Authorization rules (owner, EDIT, VIEW) must be enforced in one place.
- Data must stay in the EU.

## Considered options

1. **Cloud Firestore, written and read only by the API through the Admin SDK:** good, because it costs nothing idle and every role check runs in one code path; bad, because there is no schema, no joins and no aggregates.
2. **Cloud SQL PostgreSQL with Prisma (the first build):** good, because relational integrity, migrations and SQL reporting; bad, because the instance runs and bills around the clock.
3. **Cloud Firestore accessed from the browser with security rules (the usual Firebase pattern):** good, because the API would shrink and reads could be live; bad, because every authorization rule would have to be duplicated in the rules language and tested there.

## Decision outcome

Chosen option: **Firestore through the API only**.

- [`firestore.rules`](../../firestore.rules) denies every read and write. The Admin SDK bypasses rules, so this is the intended posture, not a placeholder. The web app has no Firestore client; if a direct read is ever needed, the fix is a new API endpoint.
- Production uses the named database `wally` in `europe-west3`, selected by `FIRESTORE_DATABASE_ID` ([`apps/api/src/env.ts`](../../apps/api/src/env.ts), `getDb` in [`apps/api/src/lib/db/client.ts`](../../apps/api/src/lib/db/client.ts)). The project's auto-created `(default)` database lives in the US and is unused.
- There is no schema and no migration step. Document shapes are declared in [`apps/api/src/lib/db/types.ts`](../../apps/api/src/lib/db/types.ts), composite indexes in [`firestore.indexes.json`](../../firestore.indexes.json). Fields added later are read through defaulting helpers in `collections.ts` (`userLanguage`, `isEmailVerified`) rather than backfilled.
- Read caches are denormalised and kept in the same transaction as their source: `memberRoles` on the board mirrors the `members` subcollection, `subtaskSummary` on a note mirrors its subtasks. Notes are a top-level collection because routes address a note by id alone (`notesCol` in `collections.ts`).

### Consequences

- Good: zero cost while idle, no connection string, no instance to patch.
- Good: one authorization implementation, in [`apps/api/src/lib/authorization.ts`](../../apps/api/src/lib/authorization.ts).
- Bad: nothing enforces document shapes at write time; a typo in a field name is silent until read.
- Bad: a missing composite index only fails in production, because the emulator never enforces indexes. The release workflow deploys indexes before code and waits for them to build.
- Bad: no cross-board reporting or aggregates. `SETUP.md` names this as the trigger for moving to a relational store.
- Neutral: the `prisma/generated` entry left in `.dockerignore` is a leftover of option 2.

### Confirmation

The release workflow asserts `FIRESTORE_DATABASE_ID=wally` on the Cloud Run service before shifting traffic. A grep for `firebase/firestore` in `apps/web/src` must stay empty.

## More information

- Why Firestore was chosen over Postgres, in one sentence: root [`README.md`](../../README.md), "Deploying".
- The database trap and the rules deploy: [`DEPLOY.md`](../DEPLOY.md), sections 4 and 13.
- What is stored and for how long: [`GDPR.md`](../GDPR.md).
