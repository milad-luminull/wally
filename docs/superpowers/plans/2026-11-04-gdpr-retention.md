# Retention (GDPR GAP-04, GAP-06, GAP-07) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share links expire (7 days, 30 days or never) and take their members' access with them, pending invites expire after 30 days, assistant usage counters after 12 months, and GDPR.md and the privacy notice state Wally's retention periods. The vendor periods follow in a second, docs-only PR (Task 10).

**Architecture:** One new column on each of `share_links` (`expires_at`) and `board_members` (`joined_by_link`). Expiry is enforced at every point of use (redeem, invite claim, `memberRoles`, board and member lists), always by the database's clock, through one helper module. The hourly `purge_expired()` database function deletes what has expired. Two small database functions do the shared work: `release_assignments()` (today's `member.remove` rule, moved so it exists once) and `remove_link_members()`; the link commands, `drainCleanupJob` and the purge call them. Logic sits in database functions only because the hourly purge runs inside the database (pg_cron); everything else stays in the API (ADR-0020).

**Tech Stack:** TypeScript, Fastify, Drizzle ORM 0.45 + drizzle-kit 0.31, PostgreSQL (Supabase, pg_cron), Zod (`@wally/shared`), React + TanStack Query, i18next, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-11-04-gdpr-retention-design.md](../specs/2026-11-04-gdpr-retention-design.md)

## Global Constraints

- **Start only after the account deletion PR (branch `docs/account-deletion-export`) is merged to `main`.** Branch from that `main`. It adds migrations `0002_*` and `0003_purge_deleted_identities.sql` and a `deleted_identities` entry in `purge_expired()`; this plan's two migrations take the next two free numbers (expected `0004`, `0005`) and keep everything the deletion work put into `purge_expired()`.
- English identifiers and stored values; German only in `apps/web/src/i18n/de.ts` (ADR-0014).
- Share-link durations offered: `DAYS_7`, `DAYS_30`, `NEVER`; default `DAYS_30`. Only the resulting `expires_at` is stored (null = never).
- Existing share links at the release: `expires_at` = migration run time + 30 days. Existing `board_members` rows: `joined_by_link = false`.
- Pending invite expires at `invited_at + 30 days`; re-inviting does not change `invited_at` (today's behaviour). Usage rows go when `day < (at - interval '12 months')::date`.
- One boundary rule and one clock: a link is expired when `expires_at <= now()`, an invite when `invited_at <= now() - interval '30 days'`, evaluated **in the database** (`now()`, or the purge's `at`). No TypeScript code compares an expiry with `new Date()`.
- **Expire on touch.** Every link command (`link.create`, `link.update`, `link.rotate`, `link.delete`, `link.redeem`) starts by deleting the board's link if it has expired, after `remove_link_members()`. From then on it behaves as if there were no link. `getShareLink` (a read-only snapshot) filters expired rows out instead.
- i18next placeholders use the project's `{{name}}` form.
- Never log a share-link token.
- **Tests set stored timestamps, not the clock.** Write `expires_at` / `invited_at` / `day` into the past (for example `now() - interval '1 second'`); pass explicit `at` values to `purge_expired()`. Fake timers only for values computed in TypeScript (`shareLinkExpiresAt`).
- No stacked PRs; E2E spec changes in this PR; CI green before the PR is marked ready. No push or PR without the owner's go-ahead.

## Review Focus

1. **The owner opens their own expired link** → 404 like anyone else; expire-on-touch runs before the owner shortcut in `link.redeem`. Test in Task 3.
2. **A member who joined by link and then claimed an email invite** (`joined_by_link = false`) → survives rotate, delete and expiry. Tests in Tasks 3 and 5.
3. **The exact boundary** → one second before expiry works, one second after fails, on every path (commands, access checks, purge). Tests in Tasks 3, 4 and 5.
4. **The release itself** → no existing member loses access; existing links get 30 days from the migration; a role-only `link.update` keeps `expires_at`. Tests in Tasks 2 and 3.
5. **An expired, not-yet-purged link is changed** (expiry set to Never, or regenerated) → 404, and its old members stay locked out. Test in Task 3.

Private notes of a removed link member stay assigned and hidden, as for `member.remove` today; Task 2's tests of `release_assignments()` pin that.

---

### Task 0: Rebase onto the merged deletion work

**Files:** none changed.

- [ ] **Step 1:** Confirm the deletion PR is merged (`gh pr list --state merged --search "account deletion"`), then `git rebase origin/main` this branch (it holds only the spec and this plan).
- [ ] **Step 2:** Read `apps/api/drizzle/meta/_journal.json` and the latest `purge_expired()` definition (the newest migration that redefines it). Note the next two free migration numbers and the current `expiring` array; Tasks 2 and 5 use both.
- [ ] **Step 3:** `make test` (or the repo's documented test command) passes on the rebased branch before any change.

### Task 1: Contract, retention constants and the expiry helpers

**Files:**

- Modify: `packages/shared/src/enums.ts`, `packages/shared/src/schemas/member.ts`, `packages/shared/src/schemas/command.ts`
- Create: `apps/api/src/lib/retention.ts`, `apps/api/src/lib/retention.test.ts`, `apps/api/src/lib/db/expiry.ts`
- Test: `packages/shared/src/schemas/member.test.ts` (create if absent, next to the schema)

**Interfaces — Produces:**

- `shareLinkDurationValues = ['DAYS_7', 'DAYS_30', 'NEVER'] as const`, `shareLinkDurationSchema`, `type ShareLinkDuration` (enums.ts). An input only; never stored.
- `shareLinkCreateSchema = z.object({ role: whiteboardRoleSchema, expiresIn: shareLinkDurationSchema.default('DAYS_30') })`.
- `shareLinkUpdateSchema = z.object({ role: whiteboardRoleSchema.optional(), expiresIn: shareLinkDurationSchema.optional() })`, refined to require at least one key.
- `link.create` input → `shareLinkCreateSchema.strict()`; `link.update` input → `shareLinkUpdateSchema` (strict). `shareLinkRoleSchema` is removed if nothing else uses it.
- `ShareLinkDto` adds `expiresAt: string | null` (ISO datetime; null = never).
- `MemberDto` adds `inviteExpiresAt: string | null` (set for `PENDING` rows, computed by the API from `invited_at`; null for `ACTIVE`) and `joinedByLink: boolean`.
- `retention.ts`: `SHARE_LINK_DURATION_DAYS: Record<ShareLinkDuration, number | null>` = `{ DAYS_7: 7, DAYS_30: 30, NEVER: null }`; `PENDING_INVITE_DAYS = 30`; `ASSISTANT_USAGE_MONTHS = 12`; `shareLinkExpiresAt(expiresIn: ShareLinkDuration, from: Date): Date | null`; `pendingInviteExpiresAt(invitedAt: Date): Date` (display only).
- `db/expiry.ts` (the only place expiry is decided at runtime): `liveShareLink(table = shareLinks): SQL` = `expires_at is null or expires_at > now()`; `livePendingInvite(table = boardMembers): SQL` = `status <> 'PENDING' or invited_at > now() - make_interval(days => PENDING_INVITE_DAYS)`. Raw SQL elsewhere (the `memberRoles` subquery) writes the same condition with a comment naming this file.

- [ ] **Step 1: Failing tests.** In `member.test.ts`: `link.create` without `expiresIn` parses to `DAYS_30`; `link.update` with `{}` fails; with `{ expiresIn: 'NEVER' }` passes; `{ expiresIn: 'DAYS_90' }` fails. In `retention.test.ts`: `shareLinkExpiresAt('DAYS_7', t)` equals `t + 7 × 86 400 000 ms`; `'NEVER'` gives `null`; `pendingInviteExpiresAt(t)` equals `t + 30 d`. (`db/expiry.ts` is tested through Tasks 3–4.)
- [ ] **Step 2:** Run `pnpm --filter @wally/shared test` and `pnpm --filter @wally/api test src/lib/retention.test.ts` → FAIL.
- [ ] **Step 3:** Implement the interfaces above.
- [ ] **Step 4:** Both runs PASS; `pnpm typecheck` shows only the expected errors in API and web code that later tasks fix (list them in the commit message body).
- [ ] **Step 5:** Commit `feat(shared): share-link expiry in the contract; retention periods in one place`.

### Task 2: Schema, migrations and the two database functions

**Files:**

- Modify: `apps/api/src/lib/postgres/schema/boards.ts`, `apps/api/src/lib/postgres/schema/schema.test.ts`, `apps/api/src/seed.ts`, `apps/api/src/lib/commands/maintenance.ts`
- Create: `apps/api/drizzle/<N>_share_link_expiry.sql` (generated, then the backfill appended) and `apps/api/drizzle/<N+1>_link_retention.sql` (`pnpm --filter @wally/api exec drizzle-kit generate --custom --name link_retention`; Task 5 adds the purge to this same file, which is safe because it is not released yet), with their snapshots and journal entries
- Test: `apps/api/src/lib/postgres/schema/link-members.test.ts`

**Interfaces — Produces:** Drizzle columns `shareLinks.expiresAt` (`instant()`, nullable) and `boardMembers.joinedByLink` (boolean, not null, default `false`). Two SQL functions (use the id columns' actual types), each followed by `revoke execute … from public, anon, authenticated, service_role`, as for `purge_expired()`:

- `release_assignments(board text, member text, at timestamptz) returns integer`: if `member` is not the board's owner and holds no `ACTIVE` row on the board, sets `assignee_id = null, updated_at = at, revision = revision + 1` on that board's notes where `assignee_id = member`, `deleted_at is null` and `visibility <> 'PRIVATE'`; returns the notes changed. Today's `member.remove` rule, moved: `drainCleanupJob` (`apps/api/src/lib/commands/maintenance.ts`) calls it instead of its own update.
- `remove_link_members(board text, at timestamptz) returns integer`: deletes the board's `board_members` rows with `joined_by_link`, calls `release_assignments` for each distinct removed user, returns the member rows deleted. It does **not** bump the board revision (callers do).

- [ ] **Step 1: Failing tests.** In `schema.test.ts`: a `board_members` row inserted without `joined_by_link` reads back `false`. In `link-members.test.ts`: `release_assignments` unassigns shared notes, leaves a private note assigned, and does nothing for a user who still holds an `ACTIVE` row or is the owner; `remove_link_members` deletes only `joined_by_link` rows of that board (not other boards', not `false` rows) and returns the count. (The backfill is one `update`; the reviewer checks it.)
- [ ] **Step 2:** Run them → FAIL.
- [ ] **Step 3:** Add the columns; `pnpm --filter @wally/api db:generate --name share_link_expiry`; append after a `--> statement-breakpoint`: `update share_links set expires_at = now() + interval '30 days';` Write the functions in the custom migration. Switch `drainCleanupJob`'s `member.remove` branch to ``tx.execute(sql`select release_assignments(${job.boardId}, ${job.userId}, ${new Date()})`)``. Update `seed.ts` (links carry an `expiresAt`, members `joinedByLink: false`).
- [ ] **Step 4:** Tests PASS; `pnpm --filter @wally/api test test/seed.test.ts test/membership-integrity.test.ts test/members-routes.test.ts` PASS (existing cleanup behaviour unchanged).
- [ ] **Step 5:** Commit `feat(api): share-link expiry and link-member columns; release_assignments() and remove_link_members()`.

### Task 3: Link commands and redeem

**Files:**

- Modify: `apps/api/src/lib/commands/administration.ts` (the `link.*` branch, the `link.redeem` and `member.invite` branches, the member upsert's `onConflictDoUpdate`), `apps/api/src/lib/commands/queries.ts` (`getShareLink`), `apps/api/src/lib/dto.ts` (`toShareLinkDto`, `toMemberDto`), `apps/api/src/routes/boards.ts` if it builds the inputs
- Test: `apps/api/test/share-links.test.ts`, `apps/api/test/invite-security.test.ts`

**Interfaces — Consumes:** Task 1 schemas, `shareLinkExpiresAt`, `pendingInviteExpiresAt`, `liveShareLink()`, `livePendingInvite()`; Task 2's `remove_link_members()`. **Produces:** `expireLinkIfDue(tx: Transaction, boardId: string): Promise<boolean>` in `administration.ts` — if the board's link exists and is not live (`not liveShareLink()`), calls `remove_link_members(boardId, now())`, deletes the link, returns `true` (the caller bumps the board revision). No cleanup jobs anywhere: removal and unassignment happen in the command's own transaction, so `commands/index.ts` is unchanged.

Behaviour (spec, "Share links" and "Members who joined through a link"):

- Every `link.*` command calls `expireLinkIfDue` first; afterwards an expired link simply does not exist (create succeeds, update/rotate/delete/redeem 404).
- `link.create`: `expiresAt = shareLinkExpiresAt(expiresIn, now)`.
- `link.update`: `role` only → `expiresAt` unchanged; `expiresIn` given → `expiresAt = shareLinkExpiresAt(expiresIn, now)`. Link members' roles are not changed.
- `link.rotate`: `remove_link_members`, then a new token with the same `expiresAt`.
- `link.delete`: `remove_link_members`, then delete.
- Any command that removes link members bumps the board revision.
- `link.redeem`: expire-on-touch before the owner shortcut. Matching rows ignore pending invites that are not live (`livePendingInvite()`). A newly created row gets `joinedByLink: true`; an existing `ACTIVE` row keeps its flag; a claimed pending invite gets `false`.
- `member.invite`: an existing row gets `joinedByLink = false` (an email invite makes membership permanent); the upsert's `set` includes `joinedByLink`. `invitedAt` is not touched.
- `getShareLink`: reads with `liveShareLink()`; an expired row → 404.
- `toShareLinkDto` adds `expiresAt: expiresAt?.toISOString() ?? null`. `toMemberDto` adds `inviteExpiresAt` (`pendingInviteExpiresAt(invitedAt)` for `PENDING`, else null) and `joinedByLink`.

- [ ] **Step 1: Failing tests** in `share-links.test.ts` (and the last one in `invite-security.test.ts`):
  - `create defaults to 30 days` (fake clock): `expiresAt` = now + 30 d; `create with NEVER has no expiry`.
  - `role-only update keeps expiresAt`; `expiresIn update restarts from now`.
  - `rotate keeps expiresAt and removes members who joined by link`: a link member assigned to a shared and a private note → afterwards 404 on the board, shared note unassigned, private note unchanged; a `joined_by_link = false` member keeps access.
  - `delete removes link members` (same, shorter).
  - `an expired link is gone for every command`: `expires_at` one second ago → GET share link 404; `link.update { expiresIn: 'NEVER' }` and `link.rotate` 404; the old link member still 404 on the board; `link.create` then 201.
  - `owner gets 404 on their own expired link`.
  - `redeem works with expires_at one second ahead and fails with it one second ago`.
  - `redeem marks a new member as joined by link`; `claiming a pending invite through a link clears joinedByLink`; `an expired pending invite cannot be claimed through a link` (`invited_at` 30 days ago → link role only, flag `true`).
  - `inviting a link member by email makes them permanent` → flag `false`, survives a later rotate.
- [ ] **Step 2:** Run both files → the new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Both PASS.
- [ ] **Step 5:** Commit `feat(api): share links expire and take their members with them`.

### Task 4: Access ends at expiry, before any purge

**Files:**

- Modify: `apps/api/src/lib/db/records.ts` (`boardColumns.memberRoles`), `apps/api/src/lib/commands/queries.ts` (`listMembers`), `apps/api/src/lib/members.ts` (`activatePendingInvitesForEmail`), `apps/api/src/lib/commands/administration.ts` (`rolesFromMembers`)
- Test: `apps/api/test/membership-integrity.test.ts`, `apps/api/test/invite-security.test.ts`, `apps/api/test/mcp.test.ts`

Behaviour:

- `memberRoles` SQL adds: `and (not m.joined_by_link or exists (select 1 from share_links l where l.board_id = whiteboards.id and (l.expires_at is null or l.expires_at > now())))`. Every access check (`requireAccess`, `listBoards`'s final filter, MCP) goes through `memberRoles`, so this is the one change that ends access.
- `listMembers` leaves out link members of a non-live link and `PENDING` rows that are not live.
- `activatePendingInvitesForEmail` adds `livePendingInvite()` to its select and to the re-read of the fresh row.
- `rolesFromMembers()` (which decides whether removing someone also releases their assignments) takes a `linkLive: boolean` argument, read with `liveShareLink()` by its caller, and skips `joinedByLink` rows when it is false.

- [ ] **Step 1: Failing tests:**
  - `a link member loses access the second the link expires` (`expires_at` one second ago, no purge, no link command): board GET 404, board missing from the list, MCP read refused.
  - `the member list hides expired invites and members of an expired link`.
  - `removing a member who also held a row from an expired link releases their assignments`.
  - `signing in with a verified email does not activate an invite whose invited_at is 30 days ago`; `does activate one 30 days minus a minute ago`.
- [ ] **Step 2:** Run the three files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS, and the full API suite `pnpm --filter @wally/api test` PASS.
- [ ] **Step 5:** Commit `feat(api): access through an expired link or invite ends at expiry`.

### Task 5: `purge_expired()` deletes what has expired

**Files:**

- Modify: `apps/api/drizzle/<N+1>_link_retention.sql` (from Task 2), `apps/api/src/lib/db/purge.ts` (`TABLES` and its doc comment), `apps/api/src/maintenance.ts` comment
- Test: `apps/api/src/lib/db/purge.test.ts`

Append to the migration `create or replace function purge_expired(at timestamptz default now())` with the **current** body from Task 0 (loop and every table the deletion work added) plus, after the loop, each returning one `(table_name, deleted)` row:

1. **`share_link_members`** — for each board whose link has `expires_at <= at`: `remove_link_members(board, at)`, and bump `whiteboards.revision` and `updated_at` where it removed anyone. Count = sum of what it returned.
2. **`share_links`** — `delete from share_links where expires_at <= at`.
3. **`board_members`** — `delete … where status = 'PENDING' and invited_at <= at - interval '30 days'`.
4. **`assistant_usage`** — `delete … where day < (at - interval '12 months')::date`.

Then the existing `revoke execute` line. The pg_cron schedule needs no change. `TABLES` gains `share_link_members: 'shareLinkMembers'`, `share_links: 'shareLinks'`, `board_members: 'pendingInvites'`, `assistant_usage: 'assistantUsage'`.

- [ ] **Step 1: Failing tests** in `purge.test.ts`:
  - `deletes an expired link and its link members, releasing shared assignments only`; a never-expiring link and a live link are untouched; a `joined_by_link = false` member is untouched; the board revision went up.
  - `deletes pending invites at PENDING_INVITE_DAYS, not a second earlier, and never ACTIVE rows` (built from the constant).
  - `deletes usage rows older than ASSISTANT_USAGE_MONTHS and keeps the boundary day` (built from the constant).
  - The existing tests still pass (no deletion-work table lost from the result).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; `pnpm --filter @wally/api test` PASS.
- [ ] **Step 5:** Commit `feat(api): the hourly purge removes expired links, their members, old invites and usage`.

### Task 6: Web — expiry choice, date, link members

**Files:**

- Modify: `apps/web/src/features/board/Share/ShareLinkControls.tsx`, `apps/web/src/features/board/Share/MemberList.tsx`, `apps/web/src/features/board/hooks/mutations/useShareLinkMutations.ts`, `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/de.ts`, `apps/web/src/test/fixtures.ts`
- Test: `apps/web/src/features/board/Share/ShareSheet.test.tsx`

**Interfaces — Consumes:** Task 1 DTOs and command inputs.

Behaviour:

- Creating a link: a duration select (7 days / 30 days / Never; 30 pre-selected), sent as `expiresIn`.
- An existing link: "Expires on {{date}}" or "Never expires", and a "Change expiry" select with the same three options, counted from today, sent as `link.update { expiresIn }`.
- One line under the link: "People who joined through this link lose access when it expires, is regenerated or turned off." Nowhere else.
- Member list: a `PENDING` member shows "Invite expires on {{date}}" (from `inviteExpiresAt`) instead of "Pending"; a `joinedByLink` member shows "Joined by link".
- Dates via the existing locale date formatter, date only.
- German: "Läuft ab am {{date}}", "Läuft nie ab", "Ablauf ändern", "7 Tage", "30 Tage", "Nie", "Wer über diesen Link beigetreten ist, verliert den Zugang, wenn er abläuft, neu erstellt oder deaktiviert wird.", "Einladung läuft ab am {{date}}", "Über Link beigetreten".

- [ ] **Step 1: Failing tests** in `ShareSheet.test.tsx`: creating defaults to 30 days and sends `expiresIn: 'DAYS_30'`; changing to Never sends `link.update { expiresIn: 'NEVER' }`; the expiry and warning lines render from a fixture; a pending member shows its expiry date; a `joinedByLink` member shows the label.
- [ ] **Step 2:** `pnpm --filter @wally/web test src/features/board/Share` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; `pnpm --filter @wally/web test` and `pnpm typecheck` PASS.
- [ ] **Step 5:** Commit `feat(web): choose a share link's expiry; see when it expires and who joined by it`.

### Task 7: E2E

**Files:** Modify `apps/web/e2e/share.spec.ts`.

- [ ] **Step 1:** Replace the `Ausstehend` (Pending) assertion with the invite-expiry line. Add: create a link with "7 Tage" and see "Läuft ab am" with today + 7 days; change it to "Nie" and see "Läuft nie ab". No second-user step (owner, 2026-11-04).
- [ ] **Step 2:** Run locally against the dev stack per `apps/web/e2e/README.md` → PASS. (Per the project rule, the CI run is the one that counts.)
- [ ] **Step 3:** Commit `test(e2e): share-link expiry choice and invite expiry line`.

### Task 8: GDPR.md and the privacy notice (Wally's own data)

**Files:**

- Modify: `docs/GDPR.md`, `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/de.ts` (`privacy.*` retention paragraph), `apps/web/src/i18n/privacyProviders.test.ts` if it asserts the text

- [ ] **Step 1: GDPR.md.** §2 gains a "Retention" table: one row per kind of data in Wally's database, from the spec's decision table, with period and what deletes it. Below it: "Data held by vendors: to follow" (Task 10). Record the owner's reason for notes and history, and the purpose of keeping per-user assistant usage counters for 12 months (cost tracking alone is covered by the anonymous monthly `assistant_spend`, so ask the owner for the per-user purpose before writing it). Mark GAP-04 resolved; GAP-06 resolved (links expire; members who joined by a link are labelled and lose access with it); GAP-07 resolved for retention, the invitation-email notice still open; GAP-08's retention half settled. Update the `share_links` and `board_members` inventory rows. Fix the deletion design's "Invite expiry is GAP-06" reference if it was merged unchanged.
- [ ] **Step 2: Privacy notice.** Rewrite the retention paragraph in `en.ts` and `de.ts` with Wally's periods. Keep "provider backups may follow separate retention schedules" until Task 10 replaces it, and the rest the deletion work left.
- [ ] **Step 3:** `pnpm --filter @wally/web test` PASS; `pnpm exec prettier --check docs` PASS.
- [ ] **Step 4:** Commit `docs: retention policy in GDPR.md; privacy notice states the periods`.

### Task 9: Whole-branch review and PR

- [ ] **Step 1:** One fresh reviewer (most capable model) reviews the whole branch against the spec; fix what it confirms.
- [ ] **Step 2:** Full `make test` (or documented equivalent) PASS.
- [ ] **Step 3:** Ask the owner before pushing. On yes: push, open the PR (body ends with the attribution line), and let CI (including E2E) go green before calling it ready.

### Task 10: Vendor retention — a second, docs-only PR after Task 9's PR merges

**Files:** Modify `docs/GDPR.md` (the retention table's vendor part), `apps/web/src/i18n/en.ts` and `de.ts` (the privacy notice's provider sentence).

- [ ] **Step 1: Research.** For each item in the spec's "Vendor retention" list, find the vendor's own documentation, record the URL and the date checked, and check Wally's actual setting (Auth0 dashboard, `gcloud logging buckets describe _Default --location=global --project=luminull-wally`, Cloudflare dashboard, Supabase dashboard — ask the owner for any console you cannot reach). Anything not verifiable is "unverified" with what was checked.
- [ ] **Step 2:** Add the vendor rows to the retention table, each with its source; replace the privacy notice's "provider backups may follow separate retention schedules; contact us for details" with the verified periods.
- [ ] **Step 3:** Settings Wally could change but the owner has not decided are listed as questions in the PR body, not written into the table.
- [ ] **Step 4:** Ask the owner before pushing; open the PR from `main` (docs only, so E2E is skipped per ADR-0012).
