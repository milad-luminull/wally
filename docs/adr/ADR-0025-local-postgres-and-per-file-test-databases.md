# ADR-0025: Local PostgreSQL in Compose, with a database per test file

- **Status:** accepted
- **Date:** 2026-10-27
- **Deciders:** Milad Rezazadeh
- **Supersedes:** [ADR-0009](ADR-0009-docker-compose-with-firestore-emulator-and-real-auth.md), in part: the Firestore emulator as the local database and its per-project test isolation. The emulator ran beside PostgreSQL until workstream 2 of [RFC-0011](../rfcs/RFC-0011-platform-migration.md) removed it from compose and CI (2026-10-31)

## Context and problem statement

Wally's database changes from Firestore to Supabase PostgreSQL
([ADR-0020](ADR-0020-supabase-postgres-through-the-api-with-drizzle.md)). The foundation
slice ([design](../superpowers/specs/2026-10-27-postgres-foundation-design.md)) needs a
PostgreSQL for development and CI before any API code uses one. Tests must keep running
in parallel, as they do on the emulator, where each test file uses its own project id.
Which PostgreSQL runs locally, and how are test files kept apart?

## Considered options

1. **Supabase's PostgreSQL image as one Compose service, and a database per test file
   cloned from a migrated template:** good, because it is the engine the hosted project
   runs, it starts with the stack, and cloning a template is fast; bad, because Supabase
   Auth and Realtime are not local yet.
2. **The Supabase CLI's local stack:** good, because it also runs Auth, Realtime and
   Storage; bad, because it manages about ten containers of its own outside Compose, and
   nothing uses those services yet.
3. **A schema per test file in one database:** good, because there is only one database
   to manage; bad, because every query and migration would have to be schema-qualified.

## Decision outcome

Chosen option: **option 1**.

- `docker-compose.yml` runs `postgres` from `supabase/postgres`, pinned to an exact tag. CI's
  unit-test job runs the same image as a service.
- It publishes no port, so several Compose projects can run side by side.
- A Vitest global setup creates `wally_template_<run>` and applies the migrations once per
  run. Each test file creates its own `wally_test_<run>_<random>` database from it with
  `CREATE DATABASE … TEMPLATE`
  ([template databases](https://www.postgresql.org/docs/current/manage-ag-templatedbs.html))
  and drops it when done.
- The run id starts with the run's start time, so several runs can share one server: each
  drops only its own databases, and leftovers of runs older than two hours are cleared at
  the next start.
- Clients disable prepared statements, as the transaction pooler requires in production.
- The Firestore emulator stays until the API has moved off Firestore (workstream 2 of
  [RFC-0011](../rfcs/RFC-0011-platform-migration.md)). The rest of ADR-0009 still holds.

### Consequences

- Good: the PostgreSQL suites run in parallel and cannot see each other's rows.
- Good: local and CI use the engine and major version a new hosted project runs.
- Bad: the image is large, and a test run needs the `postgres` service up, as it needs the
  emulator.
- Neutral: Auth and Realtime arrive locally with the identity slices, probably through the
  Supabase CLI; that will be its own decision.

### Confirmation

`apps/api/src/lib/postgres/client.test.ts` checks that each file gets its own cloned
database and that prepared statements are off.

## More information

- Setup and commands: [SETUP.md](../SETUP.md).
- Data RFC: [RFC-0008](../rfcs/RFC-0008-firestore-to-supabase.md).
