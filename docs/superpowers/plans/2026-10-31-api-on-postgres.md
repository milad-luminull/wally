# The API on PostgreSQL (workstream 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the API reads and writes only PostgreSQL; Firestore and its emulator leave the API,
compose and CI. Nothing changes for users.

**Architecture:** every Firestore read, write and transaction is rewritten in place onto the
workstream 1 foundation (Drizzle, `withTransaction`, the schema in
`apps/api/src/lib/postgres/`). There is no interim data-access layer and no dual store: the
board command transaction couples users, boards, members, notes, receipts, audit, MCP
grants and assistant records, so they switch together. `firebase-admin` stays only to verify
Firebase ID tokens until the identity slice (workstream 3).

**Tech stack:** Drizzle ORM 0.45.4 (`casing: 'snake_case'`), postgres.js 3.4.9
(`prepare: false`), `supabase/postgres:17.11.0.003`, Vitest per-file databases.

**Spec:** the design approved in chat on 2026-10-31 (summarised under "Design" below), within
[RFC-0011](../../rfcs/RFC-0011-platform-migration.md) §4,
[RFC-0008](../../rfcs/RFC-0008-firestore-to-supabase.md) and the
[foundation design](../specs/2026-10-27-postgres-foundation-design.md).

## Design (owner-approved 2026-10-31)

- The API reads and writes only PostgreSQL. Firestore, its emulator, rules and indexes are
  removed from the API, compose and CI.
- Clean start: nothing migrates, no legacy read shims are ported.
- Expiry: one `purgeExpired` deletes rows past `expires_at`; `pnpm maintenance` runs it and
  the API runs it hourly in-process. Cleanup jobs never expire.
- Database errors map into the existing error responses; a transaction that still conflicts
  after its retries gets the same retryable 500 that Firestore contention gets today.
- The runtime image ships the migrations; the release workflow applies them in place of the
  Firestore rules and indexes step.
- Everything lands in PR #87, which stays open until the hosted Supabase project and the
  proofs exist (owner, 2026-10-31).
- No user flow changes, so no Playwright spec changes; E2E runs on PostgreSQL.

## Global Constraints

- $0: no paid service, no hosted database in this plan.
- English identifiers, values and test data (ADR-0014).
- Every write transaction goes through `withTransaction` (SERIALIZABLE, bounded retry). Its
  body may run more than once and must have no effects outside the transaction.
- The HTTP contract is unchanged: DTOs keep their field names (`whiteboardId` stays in the
  API even though the column is `board_id`).
- The migration stays one file until the first hosted release: regenerate with
  `rm -rf drizzle && pnpm db:generate --name initial_schema`.
- Verification runs on the host against the test container:
  `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres pnpm turbo run test lint typecheck`.

## Review Focus

1. Read-your-own-writes: Firestore transactions never saw their own writes; PostgreSQL ones
   do. A body that writes and later re-reads the same row now sees the new value.
2. Updates of a row that vanished: Firestore threw NOT_FOUND (mapped to 404); a Drizzle
   update of a missing row silently changes nothing. Every such path must check its result.
3. Duplicate creates: `tx.create` failed on an existing document; an insert must fail the
   same way (primary key) or use an explicit conflict rule, never silently upsert.
4. Dropped caches: `memberRoles`, `shareLinkToken` and `subtaskSummary` are now computed by
   the board and note loaders; a list query that forgets them returns wrong DTOs.
5. Ordering and timestamps: Firestore orderBy on equal values and Timestamp precision
   (microseconds) differ from PostgreSQL (`timestamptz` microseconds, JS `Date`
   milliseconds); list order must be explicit wherever tests or the UI depend on it.

---

### Task 1: Plumbing, records module and test harness (Firestore still serving)

**Files:**

- Create: `apps/api/src/plugins/postgres.ts` — decorates `fastify.pg: Database`; closes it on
  `onClose` when the plugin created it.
- Create: `apps/api/src/lib/db/records.ts` — loaders and helpers shared by every module.
- Create: `apps/api/src/lib/db/ids.ts` — `newId(): string` (20 alphanumeric characters, the
  shape Firestore auto-ids had).
- Create: `apps/api/src/lib/db/purge.ts` — `purgeExpired(db, now): Promise<Record<string, number>>`.
- Modify: `apps/api/src/app.ts` (`BuildAppOptions.database?: Database`), `apps/api/src/env.ts`
  (`DATABASE_URL` required).
- Test: `apps/api/src/lib/db/records.test.ts`, `apps/api/src/lib/db/purge.test.ts`.

**Interfaces (produced, used by Task 2):**

- `type Queryable = Database | Transaction`.
- Row types in `lib/db/types.ts` from `$inferSelect`: `UserRow`, `NoteRow`, `MemberRow`,
  `ShareLinkRow`, `SubtaskRow`, `HistoryRow`, plus
  `Board = WhiteboardRow & { memberRoles: Record<string, WhiteboardRole>; shareLinkToken: string | null }`
  and `Note = NoteRow & { subtaskSummary: { total: number; done: number } }`.
- `liveBoard(q, id): Promise<Board | null>` (tombstoned reads as null) and `anyBoard(q, id)`
  for the cleanup job; `loadNote(q, id): Promise<Note | null>`; `noteColumns` (the select
  shape with the subtask counts) for list queries.
- `loadUsers(q, ids): Promise<Map<string, UserRow>>`, `normalizeEmail`, `isEmailVerified`,
  `userLanguage`, `userPreferences`, `toIso(Date)`, `toIsoOrNull`.

- [ ] Tests first: `liveBoard` returns `memberRoles` of ACTIVE members only, the share link
      token, and null for a tombstoned board; `loadNote` counts total/done subtasks;
      `purgeExpired` deletes only rows with `expires_at <= now` from the six expiring tables and
      never touches `board_cleanup`; `newId()` matches `/^[A-Za-z0-9]{20}$/`.
- [ ] Implement; app decorates `fastify.pg` from `options.database ?? createDatabase(DATABASE_URL)`.
- [ ] `test/helpers.ts`: `buildTestApp` also creates a per-file `TestDatabase` and passes it
      as `database`; `TestContext` gains `pg`. Suite stays green (Firestore still serves).
- [ ] Commit.

### Task 2: The switch

All of `apps/api/src` except the scripts of Task 3 moves at once, in this order of local
commits (the suite is red between them; nothing is pushed until it is green):

1. `lib/db/types.ts` row types replace the Firestore document types; `whiteboardId` becomes
   `boardId` in domain code; `dto.ts` maps rows to the unchanged DTOs.
2. Accounts: `plugins/auth.ts` provisioning, `lib/auth/identities.ts`, `routes/me.ts`.
3. Boards core: `lib/authorization.ts`, `lib/members.ts`, `lib/notes.ts`, `lib/visibleLinks.ts`,
   `lib/commands/*` (receipts in `board_operations`, audit, cleanup jobs in `board_cleanup`,
   `drainCleanupJob` by SQL deletes; `reconcileBoards` is deleted — there are no caches to
   repair), routes for boards, notes, members.
4. MCP: `lib/mcp/grants.ts`, `lib/mcp/rate.ts`, `routes/mcp.ts`, `routes/connections.ts`;
   the command's `authorize` hook takes a `Transaction`.
5. Assistant: `budget/ledger.ts`, `conversations.ts`, `guards.ts`, `suggestions.ts`,
   `tidy.ts`, `captureProposal.ts`, `turn.ts`, `run.ts`, `routes/assistant.ts`.
6. Tests: every test file uses `ctx.pg` (Drizzle) for fixtures and assertions;
   `resetDatabase(db)` truncates every table; per-file emulator project ids go.

Rules for the rewrite:

- `runTransaction`/`runQueryTransaction` → `withTransaction`; `tx.create` → insert (a
  duplicate key fails as before); `tx.update` on a row that may be gone checks the returned
  row count and keeps today's outcome (404 where Firestore's NOT_FOUND gave 404).
- Writers stop maintaining `memberRoles`, `shareLinkToken` and `subtaskSummary`.
- Fixed revisions stay as written today (`revision: 1` at creation, `+ 1` per write).

- [ ] New concurrency tests on the real routes: two concurrent board creations at 19
      boards end at 20; two writes with the same expected revision give one 200 and one 409;
      the same operation id sent twice concurrently commits once and replays once.
- [ ] Full suite, lint and typecheck green; then push.

### Task 3: Scripts and seeds

`seed.ts`, `lib/auth/local-mcp-seed.ts`, `lib/auth/e2e-seed.ts`, `assistant-smoke.ts`,
`capture-eval.ts`, `maintenance.ts` (drain cleanup + `purgeExpired`; `--apply` reconcile
goes), `seed-mcp-local.ts`. The API starts an hourly `purgeExpired` timer in `server.ts`
(not in `buildApp`, so tests never run it), unref'd, logging counts.

- [ ] Tests for the seed's idempotence and for maintenance's purge; suite green; commit.

### Task 4: Remove Firestore

- Delete `lib/db/client.ts`, `lib/db/transaction.ts`, `lib/db/collections.ts`,
  `plugins/firestore.ts`, `lib/postgres/isolation.test.ts`, `firestore.rules`,
  `firestore.indexes.json`, `infra/firebase-emulator.Dockerfile`,
  `scripts/wait-firestore-indexes.mjs`; firebase.json keeps only what Hosting needs.
- Compose (`docker-compose*.yml`), the Makefile, CI's unit job (no emulator) and E2E job
  run on PostgreSQL only; `FIRESTORE_*` env vars go.
- `errorReplyFor` drops the gRPC NOT_FOUND branch.
- [ ] `grep -rn "firebase-admin/firestore" apps` is empty; suite green; commit.

### Task 5: Release packaging and docs

- Runtime image copies `apps/api/drizzle`; a `migrate` entry (`node dist/migrate-cli.js`)
  applies them.
- `release.yml`: the Firestore rules and indexes step becomes "apply migrations" with a
  `DATABASE_URL` secret; Cloud Run gets `DATABASE_URL` from Secret Manager. Both fail loudly
  while the secret is missing; nothing is created in GCP or Supabase here.
- Docs: SETUP, DEPLOY, architecture, GDPR (data location and deletion), RFC-0008 status,
  RFC index (RFC-0011 workstream 2 built, not in production), ADR-0009/0025 notes.
- [ ] Suite green; CI green; commit and push.

### Final

One whole-branch review on the most capable model, one fix wave, then report.
