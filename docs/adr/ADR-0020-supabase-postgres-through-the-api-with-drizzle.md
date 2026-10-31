# ADR-0020: Supabase PostgreSQL with Drizzle, reached only through the API

- **Status:** accepted
- **Date:** 2026-10-26
- **Deciders:** Milad Rezazadeh
- **Supersedes:** [ADR-0003](ADR-0003-firestore-reached-only-through-the-api.md)
- **Amended 2026-10-31:** the hosted project is in Ireland (`eu-west-1`), not Frankfurt; the
  owner kept the region the project was created in
  ([RFC-0011](../rfcs/RFC-0011-platform-migration.md) section 8).

## Context and problem statement

Wally keeps all data in Cloud Firestore, reached only by the API (ADR-0003). Firestore was
chosen because nothing bills while idle. It has no schema, no joins and no aggregates, and
every invariant depends on its transaction semantics.

On 2026-10-26 the owner chose one provider for data and identity, Supabase, starting on the
Free plan ([tech stack brief](../researches/2026-10-26-tech-stack-and-architecture.md)).

The question: which database and data-access layer should Wally use, and who may talk to
the database?

## Decision drivers

- $0/month in development, and under $50/month for the initial release.
- Data stays in the EU.
- Authorization is still enforced in one place, the API.
- Relational integrity, migrations and SQL reporting.
- The API behaves exactly as today: revisions, command receipts and every other
  invariant hold. No data moves; production starts on an empty database (owner,
  2026-10-27).

## Considered options

1. **Supabase PostgreSQL (Frankfurt), reached only by the API, with Drizzle:**
   - Good: schema, joins and integrity, with the same provider as identity.
   - Bad: a rewrite of the persistence layer.
2. **Stay on Firestore:**
   - Good: no persistence rewrite.
   - Bad: no relational queries, and it keeps Firebase, which is being decommissioned.
3. **Neon with a separate identity provider:**
   - Good: built for idle databases.
   - Bad: two providers where the owner wants one.
4. **Browser access through the Supabase Data API and RLS:**
   - Good: a smaller API.
   - Bad: every board rule would be rewritten as policies.

## Decision outcome

Chosen option: **option 1**.

- **Only the API reaches application tables.**
  - The Data API is switched off
    ([securing your API](https://supabase.com/docs/guides/api/securing-your-api)).
  - RLS is enabled on application tables with no permissive policies, as a safety net.
  - The API uses a dedicated role.
  - When the browser needs data, the answer is an API endpoint.
- **Schema and migrations:** Drizzle holds the schema and builds queries. SQL migrations
  live in the repository and are applied once per release, before the new revision takes
  traffic.
- **Connections** go through the transaction pooler on port 6543, with prepared statements
  off. On Free that is the IPv4 path
  ([connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)).
- **Data shape:**
  - IDs are text, and timestamps are `timestamptz`.
  - TTL policies become `expires_at` columns with a scheduled purge.
  - One isolation strategy, proven by concurrency tests, keeps the invariants that
    relied on Firestore's serializable transactions.
- **Free plan:** we run our own backups, and a restore drill passes before cutover,
  because Free has no managed backups
  ([backups](https://supabase.com/docs/guides/platform/backups)).

The scope, data inventory, backup routine and switch are in the
[data RFC](../rfcs/RFC-0008-firestore-to-supabase.md).

### Consequences

- Good: shapes are enforced on write. Relations, aggregates and pgvector become available.
- Good: data and identity live in one project, which simplifies account deletion and
  export.
- Bad: about 40 source files and 30 test files use Firestore directly, with no repository
  layer to swap. Every transaction-dependent invariant has to be re-proven.
- Bad: on Free there are no managed backups.
  - Free projects can pause after low activity. Real activity typically avoids a pause,
    but that is not guaranteed; only Pro is exempt
    ([project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)).
  - The database quota is 500 MB (owner brief).
- Bad:
  - Traffic from Cloud Run in Belgium to Frankfurt adds latency, still to be measured.
  - The database credential is long-lived, where Firestore used keyless IAM. It lives
    in Secret Manager.
- Neutral: the release workflow swaps its Firestore index wait for a migration step.
  ADR-0009's Firestore emulator is replaced by a local Supabase stack, recorded in its
  own ADR in workstream 1.

### Confirmation

- After cutover, `apps/api` imports nothing from `firebase-admin/firestore`.
- `apps/web/src` creates no Supabase table client.
- Integration tests run against real PostgreSQL.
- The release checks the migration level before traffic shifts.

## More information

- [Platform migration](../rfcs/RFC-0011-platform-migration.md) and the [data RFC](../rfcs/RFC-0008-firestore-to-supabase.md).
- Browser access to Supabase Auth and Realtime: ADR-0021 and ADR-0023.
