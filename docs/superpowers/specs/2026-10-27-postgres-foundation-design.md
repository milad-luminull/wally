# PostgreSQL foundation (migration slice 1) — design

> **Status:** approved by the owner on 2026-10-27; not built yet.

Date: 2026-10-27. Workstream 1 of the [platform migration](../../rfcs/RFC-0011-platform-migration.md);
data rules in the [data RFC](../../rfcs/RFC-0008-firestore-to-supabase.md) and
[ADR-0020](../../adr/ADR-0020-supabase-postgres-through-the-api-with-drizzle.md).

## Intent

Wally's database changes from Firestore to Supabase PostgreSQL; no data moves. This slice builds everything the switch
(workstream 2) needs, without switching: the schema, migrations, a local database, a test
harness, the connection setup and the transaction rule. The API keeps running on Firestore.

The owner chose to build this before the proofs (workstream 0) on 2026-10-27, because it
needs no Supabase account, no browser and no spending, so it can be built while the owner
is away. The proofs follow as the next slice.

**Clean start (owner, 2026-10-27):** production holds no data to keep. Nothing is exported,
imported or carried over, so there is no importer, no reconciler and no rehearsal.

## Goals

1. A Drizzle schema covering every collection in RFC-0008's inventory, with SQL migrations
   in the repository.
2. A local PostgreSQL in the compose stack, next to the Firestore emulator.
3. A test harness where every test file gets its own database, so files run in parallel.
4. A connection module that works through Supabase's transaction pooler.
5. One transaction helper that decides isolation and retry for all future code, proven by
   concurrency tests.
6. A mapping from PostgreSQL error codes to Wally's errors.
7. CI runs the new tests against real PostgreSQL.

## Non-goals

- No API route, service or test moves off Firestore. That is workstream 2 (slices 3 and 4).
- No Supabase project, no hosted database, no secrets, no release workflow change.
- No backup routine or restore drill: they need a hosted project and move to the proofs
  slice (RFC-0011 §5 item 4).
- No Supabase Auth, Realtime or Storage locally. They arrive with the slices that use them.
- No expiry purge job. The `expires_at` columns exist; the job comes with the switch.
- No database role setup for production (the dedicated API role in ADR-0020). That needs
  the hosted project.

## Anti-goals

- Anything that changes what production does or costs. The slice must deploy as a no-op.
- A second persistence path that code starts to use before workstream 2. Nothing outside
  the new module and its tests imports it.
- Tests that pass only when run one file at a time.

## Constraints

- **$0.** No paid service or add-on (owner rule: nothing is spent without manual
  approval).
- **Pooler-safe:** the hosted connection will go through the transaction pooler on port
  6543, which does not support prepared statements
  ([connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)). The
  client disables them everywhere, including locally, so local tests catch anything that
  would break there.
- **Same engine locally as hosted:** the local container uses Supabase's PostgreSQL image,
  pinned to an exact tag. Its major version must match what a new hosted project runs;
  the proofs slice confirms it and adjusts the pin if needed.
- **English identifiers and values** in schema, code and test data (ADR-0014).
- **Dev container:** a new dependency needs a host install, a container install and an
  image rebuild before `make test` sees it.
- **Delivery:** one PR from `main`, after the docs PR with this design is merged. That
  docs PR also brings RFC-0008, RFC-0011 and ADR-0020 in line with the clean start and
  the new order. No user flow changes, so no Playwright spec changes; the PR says so.

## Decided

**Schema:**

- Every collection in RFC-0008 "What the schema covers" gets a table, following its schema
  rules: IDs stay opaque `text`, timestamps are `timestamptz`, nested maps and arrays are
  `jsonb` unless a child table is needed for a query or constraint.
- No legacy defaults: the clean start means no record predates v0.11.0.
- Every TTL policy becomes an `expires_at` column with an index.
- Board and note children cascade with `ON DELETE CASCADE`.
- RLS is enabled on every application table with no policies (ADR-0020's safety net). A
  test fails if a table is missing it.
- The shapes come from `apps/api/src/lib/db/types.ts` and the auth, MCP and command
  modules. Until the first production release on PostgreSQL, migrations may be rewritten
  or squashed, because no hosted database has applied them.

**Local database:** a `postgres` service in `docker-compose.yml` using the Supabase
PostgreSQL image, with a health check. The API container depends on it and gets
`DATABASE_URL`. The Firestore emulator stays until workstream 2 removes it. A new ADR
records the local database and partly supersedes ADR-0009.

**Test isolation:** migrations are applied once to a template database before the run;
each test file then creates its own database from that template and drops it when done
(PostgreSQL's `CREATE DATABASE … TEMPLATE`,
[template databases](https://www.postgresql.org/docs/current/manage-ag-templatedbs.html)).

**Transaction rule:** one helper, used by all future data code, runs every transaction at
`SERIALIZABLE` and retries a bounded number of times, with jitter, when PostgreSQL reports
a serialization failure (`40001`) or a deadlock (`40P01`). PostgreSQL's documentation
expects applications using this level to retry such failures
([transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)).
This replaces what Firestore's serializable transactions and SDK retries gave Wally for
free. Explicit row locks were the alternative; they are faster under load but have to be
remembered at each call site.

**Proof of the rule:** concurrency tests at SQL level, using the real schema, show that:

- concurrent board creations never take an owner past 20 boards;
- of two concurrent writes against the same note revision, exactly one succeeds and the
  other reports a stale revision.

**Error mapping:** `40001`/`40P01` after the last retry, `23505` (unique violation),
`23503` (foreign key violation) and `23514` (check violation) map to Wally error types,
mirroring how Firestore's gRPC codes map today. Exactly which Wally error each one
becomes is settled per call site in workstream 2; this slice provides the classification.

**CI:** the unit-test job also starts PostgreSQL (same image and tag) and passes
`DATABASE_URL`. Only the new test files need it; the Firestore suites are unchanged.

**Docs in the implementation PR:** SETUP.md (local database), the new ADR and the ADR
index, and the RFC index's "In production" note for RFC-0011 (workstream 1 built, not
used by production).

## Left to the builder

- The module's location and file layout (suggested: `apps/api/src/lib/postgres/` for the
  client, schema and transaction helper, and the migrations folder next to the API package).
- The PostgreSQL driver Drizzle uses, as long as prepared statements can be turned off.
  Check against Drizzle's and Supabase's documentation, and cite them.
- Table and column names (snake_case), index choices beyond `expires_at` and foreign keys,
  and which nested values become child tables.
- The retry count and backoff, within "bounded" and "with jitter".
- How the harness names, creates and cleans up per-file databases, and how `make test`
  waits for PostgreSQL.
- The exact Supabase PostgreSQL image tag.

## Done when

- `make up` starts PostgreSQL next to the existing stack; the app behaves exactly as
  before.
- Migrations apply cleanly to an empty database, and the RLS check passes.
- The schema covers every collection in RFC-0008's inventory.
- The transaction helper, error mapping and both concurrency proofs have passing tests,
  and test files run in parallel.
- CI is green, including E2E, which is unchanged.
- Nothing outside the new module and its tests imports it.
