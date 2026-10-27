# Firestore to Supabase

- **Status:** Supabase selected for data and identity; migration pending. Revised 2026-10-26.
- **Date:** 2026-10-19, revised 2026-10-26
- **Decision:** [ADR-0020](../adr/ADR-0020-supabase-postgres-through-the-api-with-drizzle.md)
- **Context:** [platform migration](RFC-0011-platform-migration.md), workstreams 1 and 2.
- **Reference:** [provider research](../researches/2026-10-19-provider-strategy.md)

## Decision and scope

Move all Wally application data from Firestore to **Supabase PostgreSQL in Frankfurt**,
with Drizzle as the schema and query layer.

**What stays the same:**

- Fastify on Cloud Run.
- The REST and MCP contracts.
- Frontend behavior.

**Access rules:**

- Only the API reads and writes application tables.
- The Data API is disabled.
- The browser reaches Supabase only for Auth and Realtime (ADR-0021, ADR-0023).

**Identity:** Supabase Auth replaces Auth0 in the [identity RFC](RFC-0012-supabase-auth-and-mcp.md),
after this cutover. This migration carries the existing `authIdentities` mappings
unchanged.

**Cost:** stay on Supabase Free as long as it is sufficient: $0 in development, and the
initial release stays under $50/month.

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

- **IDs stay text.** User ids (random UUIDs from Auth0 signups; since the v0.11.0 data
  reset none is a Firebase UID), Firestore auto-ids, the first board keyed by its owner's
  user id, receipt and audit ids, and share tokens all keep their exact values. Foreign
  keys use those values.
- **No legacy defaults.** Every production document was written by v0.11.0 or later, after
  the reset ([ADR-0024](../adr/ADR-0024-rename-persisted-values-without-migration.md)), so
  the defaults for fields older documents lacked are not needed: new notes get
  `description` and `visibility` from the create schema, notes and boards start at
  `revision` 1, and Auth0 signups write `language` and `emailVerified`. `links` is absent
  until a note is first linked and imports as an empty list. The owner is to confirm this
  before the import drops the other defaults.
- **Nested maps and arrays become `jsonb` or child tables.** This covers preferences,
  `inFlight` slots, conversation messages and suggestion/tidy payloads. Each one becomes
  a child table only where it is queried or constrained.
- **Timestamps become `timestamptz`.** Values that the newer MCP code stores as ISO
  strings or epoch seconds keep their meaning.
- **Enum values import exactly as stored.** They are already English: the German values
  were replaced in v0.11.0 ([ADR-0024](../adr/ADR-0024-rename-persisted-values-without-migration.md)),
  so the import carries no value mapping.

## Behavior that must be re-proven in SQL

Firestore transactions are serializable and retried by the SDK, and several invariants
depend on that, including queries inside transactions. Choose an isolation strategy in
workstream 1. Either works, as long as tests prove it:

- `serializable` with a bounded retry;
- explicit row locks on the aggregate root, the board or the user.

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

1. **Foundation (workstream 1, additive):**
   - Drizzle schema and SQL migrations in the repository.
   - A local Supabase stack for development and CI. This replaces the Firestore
     emulator, and ADR-0009 is superseded in that slice.
   - Tests isolated per file, so they still run in parallel. Today each file gets its
     own emulator project.
   - A Firestore-to-Postgres importer and reconciler.
   - Connection through the transaction pooler, with prepared statements off.
   - A nightly encrypted `pg_dump`/`supabase db dump`, stored outside Supabase, plus a
     timed restore drill. Free has no managed backups
     ([backups](https://supabase.com/docs/guides/platform/backups)).
2. **Rehearse on an isolated copy:**
   - First the local emulator export: the owner's working board, exported before
     anything else runs.
   - Then a production export on a free rehearsal project.
   - Preserve IDs, ownership, memberships, private notes, invites, history, revisions,
     receipts, cleanup jobs, assistant state and budgets, identity mappings and MCP
     connections, including their tombstones.
   - Reconcile counts and relationships, and spot-check content.
3. **Verify:**
   - Permission checks, concurrent writes and stale revisions.
   - Retry and replay safety, deletion and cleanup.
   - MCP reads and writes.
   - The full E2E suite against Postgres.
4. **Cut over during a bounded write freeze:**
   - Snapshot Firestore, import and reconcile.
   - Switch the API to PostgreSQL, and verify before reopening writes.
   - Define the rollback window and how writes made after cutover are recovered, before
     starting.
   - No permanent dual writes.

## Done when

- Existing data and API behavior are preserved.
- Migration checks and a restore drill pass.
- The API has no Firestore dependency.

Update DEPLOY, SETUP, the architecture overview and the GDPR inventory, including
Supabase as a processor and the backup location. Retire Firestore only after the agreed
rollback window. A final export is kept encrypted for the agreed retention.
