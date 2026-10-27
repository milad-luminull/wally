# Firestore to Supabase

- **Status:** Supabase selected for data and identity; migration pending. Revised
  2026-10-27 for the clean start.
- **Date:** 2026-10-19, revised 2026-10-26 and 2026-10-27
- **Decision:** [ADR-0020](../adr/ADR-0020-supabase-postgres-through-the-api-with-drizzle.md)
- **Context:** [platform migration](RFC-0011-platform-migration.md), workstreams 1 and 2.
- **Reference:** [provider research](../researches/2026-10-19-provider-strategy.md)

## Decision and scope

Move Wally's application data from Firestore to **Supabase PostgreSQL in Frankfurt**,
with Drizzle as the schema and query layer.

**Clean start (owner, 2026-10-27):** no Firestore data is exported, imported or carried
over. Production starts empty on PostgreSQL. There is no importer, reconciler or
rehearsal.

**What stays the same:**

- Fastify on Cloud Run.
- The REST and MCP contracts.
- Frontend behavior.

**Access rules:**

- Only the API reads and writes application tables.
- The Data API is disabled.
- The browser reaches Supabase only for Auth and Realtime (ADR-0021, ADR-0023).

**Identity:** Supabase Auth replaces Auth0 in the [identity RFC](RFC-0012-supabase-auth-and-mcp.md),
after this switch. The `authIdentities` table starts empty; mappings are created as
users sign in.

**Cost:** stay on Supabase Free: $0 in development, and the initial release stays under
$50/month. Nothing is spent, and Pro is not bought, without the owner's approval.

**Out of scope:** uploads, vector search and background workers. See
[uploads and retrieval](RFC-0009-uploads-and-retrieval.md) and [durable workers](RFC-0010-durable-ai-workers.md).

## What has to move

There are 19 collection paths (`apps/api/src/lib/db/collections.ts`, plus the auth, MCP and
command modules). Shapes are in `apps/api/src/lib/db/types.ts`, plus the auth and MCP
modules.

- **Accounts:**
  - `users`, with embedded preferences;
  - `authIdentities`;
  - per-user `mcpConnections` and `mcpLimits` (the MCP request and write budgets);
  - `accountDeletionJobs` and `accountDenials` are gone: nothing read them after PR #76,
    and they were deleted on 2026-10-27. Nothing to migrate.
- **Boards:**
  - `whiteboards` and its `members`, with the cached `memberRoles`;
  - `shareLinks`.
- **Notes:**
  - `notes` with `subtasks` and `history`, and the cached `subtaskSummary`.
- **Safety:**
  - per-user `boardOperations` receipts (7-day expiry);
  - `boardCleanup` jobs (no expiry);
  - `assistantAudit` (30-day expiry).
- **Assistant:**
  - per-user `assistantUsage`, `assistantAttempts`, `assistantConversations`,
    `assistantSuggestions`, `assistantTidies`;
  - the deployment-wide `assistantSpend`.

Rules for the schema:

- **IDs stay opaque text.** User ids, generated ids, the first board keyed by its
  owner's user id, receipt and audit ids, and share tokens keep the formats the code
  creates today. Foreign keys use those values.
- **No legacy defaults.** Nothing predates the clean start, so the read shims for fields
  older documents lacked are not ported: new notes get `description` and `visibility`
  from the create schema, notes and boards start at `revision` 1, and signups write
  `language` and `emailVerified`. `links` defaults to an empty list.
- **Nested maps and arrays become `jsonb` or child tables.** This covers preferences,
  `inFlight` slots, conversation messages and suggestion/tidy payloads. Each one becomes
  a child table only where it is queried or constrained.
- **Timestamps become `timestamptz`.** Values that the newer MCP code stores as ISO
  strings or epoch seconds keep their meaning.
- **Enum values are the English values** the code writes today
  ([ADR-0024](../adr/ADR-0024-rename-persisted-values-without-migration.md)).

## Behavior that must be re-proven in SQL

Firestore transactions are serializable and retried by the SDK, and several invariants
depend on that, including queries inside transactions. Workstream 1 chose
`serializable` with a bounded retry over explicit row locks
([slice 1 design](../superpowers/specs/2026-10-27-postgres-foundation-design.md)); tests
prove it for each invariant as it moves.

The invariants:

- **Board commands:**
  - Read the receipt first, then reject a fingerprint mismatch with 409.
  - Replay stored results even after the target was deleted.
  - Re-check privacy before revealing a replayed result.
  - Return 409 on a stale revision.
  - Write the receipt, the change and the audit record atomically.
- **Cached views:** `memberRoles` and `subtaskSummary` change in the same commit as
  their source rows. The subtask copy limit of 400 still applies.
- **Board limit:** at most 20 boards per owner, with no phantom inserts.
- **One connection per client:** at most one active MCP connection per user and client.
  The Auth0 signup email-collision denial stays until Auth0 is retired.
- **Assistant budget:**
  - At most two in-flight slots, each on a 120 s lease.
  - Daily token cap and monthly spend cap.
  - Settling happens exactly once, and releasing keeps the charge.
- **Assistant records:** conversation turn-count guards, and compare-and-set claims on
  suggestions and tidies.
- **Account export and deletion:** none to preserve. They are rebuilt on PostgreSQL
  later, against the new schema.
- **Invites:** activation only for a verified email. Duplicate rows collapse. An invite
  for the board owner is removed.
- **Error codes:** today Firestore's gRPC codes map to Wally errors (5 → 404, contention
  → retry or `ASSISTANT_BUSY`). The SQLSTATE codes need their own mapping (for example
  `40001` and `23505`).

**Expiry and cleanup:**

- The six TTL policies become `expires_at` columns, purged by a scheduled job, either
  pg_cron or the background service.
- The purge must never touch `boardCleanup`.
  It must not touch MCP revocation tombstones either, until a retention policy exists.
- Board and note deletion cascade with `ON DELETE CASCADE`, behind the existing
  tombstone.

## Migration

1. **Foundation (workstream 1, additive, built first):** see the
   [slice 1 design](../superpowers/specs/2026-10-27-postgres-foundation-design.md).
   - Drizzle schema and SQL migrations in the repository.
   - A local PostgreSQL in the compose stack, beside the Firestore emulator until the
     switch. ADR-0009 is partly superseded in that slice.
   - Tests isolated per file, so they still run in parallel.
   - Connection through the transaction pooler, with prepared statements off.
   - The transaction helper and the mapping from SQLSTATE codes to Wally errors.
2. **Backups (workstream 0 proof, before the switch):** a nightly encrypted
   `pg_dump`/`supabase db dump`, stored outside Supabase, plus a timed restore drill.
   Free has no managed backups
   ([backups](https://supabase.com/docs/guides/platform/backups)).
3. **Move the API onto PostgreSQL (workstream 2):** first behind a data-access layer that
   still uses Firestore, then on PostgreSQL. Verify:
   - Permission checks, concurrent writes and stale revisions.
   - Retry and replay safety, deletion and cleanup.
   - MCP reads and writes.
   - The full E2E suite against PostgreSQL.
4. **Switch production:**
   - Apply the migrations to the empty hosted database, then release the API on
     PostgreSQL. Nothing is copied from Firestore.
   - Define the rollback window before starting. No permanent dual writes.

## Done when

- API behavior is preserved, on an empty database.
- A restore drill has passed.
- The API has no Firestore dependency.

Update DEPLOY, SETUP, the architecture overview and the GDPR inventory, including
Supabase as a processor and the backup location. Retire Firestore after the agreed
rollback window. No final export is kept, since nothing is carried over.
