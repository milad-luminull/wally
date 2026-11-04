# Retention (GDPR GAP-04, GAP-06, GAP-07) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share links expire (7 days, 30 days or never) and take their members' access with them, pending invites expire after 30 days, assistant usage counters after 12 months, and GDPR.md and the privacy notice state every retention period, vendors included.

**Architecture:** New columns on `share_links` and `board_members`; expiry is enforced at every point of use (redeem, invite claim, `memberRoles`, board and member lists), and the hourly `purge_expired()` database function deletes what has expired. Periods live once in `apps/api/src/lib/retention.ts`; a test keeps the SQL in step.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM 0.45 + drizzle-kit 0.31, PostgreSQL (Supabase, pg_cron), Zod (`@wally/shared`), React + TanStack Query, i18next, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-11-04-gdpr-retention-design.md](../specs/2026-11-04-gdpr-retention-design.md)

## Global Constraints

- **Start only after the account deletion PR (branch `docs/account-deletion-export`) is merged to `main`.** Branch from that `main`. It adds migrations `0002_*` and `0003_purge_deleted_identities.sql` and a `deleted_identities` entry in `purge_expired()`; this plan's migrations take the next two free numbers (expected `0004`, `0005`) and keep everything the deletion work put into `purge_expired()`.
- English identifiers and stored values; German only in `apps/web/src/i18n/de.ts` (ADR-0014).
- Share-link expiry values: `DAYS_7`, `DAYS_30`, `NEVER`; default `DAYS_30`.
- Existing share links at the release: `expiry = 'DAYS_30'`, `expires_at` = migration run time + 30 days.
- Existing `board_members` rows at the release: `joined_by_link = false`.
- Pending invite expires at `invited_at + 30 days`; usage rows go when `day < (at - interval '12 months')::date`.
- One boundary rule everywhere: a thing is expired when `expires_at <= now` (links) or `invited_at <= now - 30 days` (invites).
- Never log a share-link token.
- No stacked PRs; E2E spec changes in this PR; CI green before the PR is marked ready. No push or PR without the owner's go-ahead.

## Review Focus

1. **The owner opens their own expired link** → 404 like anyone else; the owner shortcut in `link.redeem` must come after the expiry check. Test in Task 4.
2. **A member who joined by link and then claimed an email invite** (`joined_by_link = false`) → survives rotate, delete and expiry. Tests in Tasks 3, 4 and 6.
3. **The exact boundary** → one second before expiry works, at expiry fails, in TypeScript and in SQL alike. Tests in Tasks 4, 5 and 6.
4. **The release itself** → no existing member loses access; existing links get 30 days from the migration; a role-only `link.update` keeps `expires_at`. Tests in Tasks 2 and 3.
5. **Private notes of a removed link member** stay assigned and hidden, as for `member.remove` today. Tests in Tasks 3 and 6.

---

### Task 0: Rebase onto the merged deletion work

**Files:** none changed.

- [ ] **Step 1:** Confirm the deletion PR is merged (`gh pr list --state merged --search "account deletion"`), then `git rebase origin/main` this branch (it holds only the spec and this plan).
- [ ] **Step 2:** Read `apps/api/drizzle/meta/_journal.json` and the latest `purge_expired()` definition (the newest migration that redefines it). Note the next two free migration numbers and the current `expiring` array; Tasks 2 and 6 use both.
- [ ] **Step 3:** `make test` (or the repo's documented test command) passes on the rebased branch before any change.

### Task 1: Contract and retention constants

**Files:**

- Modify: `packages/shared/src/enums.ts`, `packages/shared/src/schemas/member.ts`, `packages/shared/src/schemas/command.ts`
- Create: `apps/api/src/lib/retention.ts`, `apps/api/src/lib/retention.test.ts`
- Test: `packages/shared/src/schemas/member.test.ts` (create if absent, next to the schema)

**Interfaces — Produces:**

- `shareLinkExpiryValues = ['DAYS_7', 'DAYS_30', 'NEVER'] as const`, `shareLinkExpirySchema`, `type ShareLinkExpiry` (enums.ts).
- `shareLinkCreateSchema = z.object({ role: whiteboardRoleSchema, expiry: shareLinkExpirySchema.default('DAYS_30') })`.
- `shareLinkUpdateSchema = z.object({ role: whiteboardRoleSchema.optional(), expiry: shareLinkExpirySchema.optional() })` refined to require at least one key.
- `link.create` input → `shareLinkCreateSchema.strict()`; `link.update` input → `shareLinkUpdateSchema` (strict). `shareLinkRoleSchema` is removed if nothing else uses it.
- `ShareLinkDto` adds `expiry: ShareLinkExpiry`, `expiresAt: string | null`, `lastRedeemedAt: string | null` (ISO datetimes).
- `MemberDto` adds `invitedAt: string` and `joinedByLink: boolean`.
- `PENDING_INVITE_DAYS = 30`, exported from `@wally/shared` (enums.ts, next to the expiry values) so the web app and the API use one number.
- `retention.ts`: `SHARE_LINK_EXPIRY_DAYS: Record<ShareLinkExpiry, number | null>` = `{ DAYS_7: 7, DAYS_30: 30, NEVER: null }`; re-exports `PENDING_INVITE_DAYS`; `ASSISTANT_USAGE_MONTHS = 12`; `shareLinkExpiresAt(expiry: ShareLinkExpiry, from: Date): Date | null`; `isShareLinkLive(link: { expiresAt: Date | null }, now: Date): boolean`; `isPendingInviteLive(invitedAt: Date, now: Date): boolean`; `pendingInviteCutoff(now: Date): Date`.

- [ ] **Step 1: Failing tests.** In `member.test.ts`: `link.create` without `expiry` parses to `DAYS_30`; `link.update` with `{}` fails; with `{ expiry: 'NEVER' }` passes; `{ expiry: 'DAYS_90' }` fails. In `retention.test.ts`: `shareLinkExpiresAt('DAYS_7', t)` equals `t + 7 × 86 400 000 ms`; `'NEVER'` gives `null`; `isShareLinkLive({ expiresAt: t }, t)` is `false` and at `t − 1 s` is `true`; `isPendingInviteLive(t, t + 30 d)` is `false`, at `t + 30 d − 1 s` is `true`.
- [ ] **Step 2:** Run `pnpm --filter @wally/shared test` and `pnpm --filter @wally/api test src/lib/retention.test.ts` → FAIL.
- [ ] **Step 3:** Implement the interfaces above.
- [ ] **Step 4:** Both runs PASS; `pnpm typecheck` shows only the expected errors in API and web code that later tasks fix (list them in the commit message body).
- [ ] **Step 5:** Commit `feat(shared): share-link expiry in the contract; retention periods in one place`.

### Task 2: Schema and the column migration

**Files:**

- Modify: `apps/api/src/lib/postgres/schema/boards.ts`, `apps/api/src/lib/postgres/schema/schema.test.ts`, `apps/api/src/seed.ts`
- Create: `apps/api/drizzle/<N>_share_link_expiry.sql` (generated, then the backfill appended), its snapshot and journal entry

**Interfaces — Produces:** Drizzle columns `shareLinks.expiry` (text, not null, default `'DAYS_30'`, check `share_links_expiry_check` via `oneOf`), `shareLinks.expiresAt` (`instant()`, nullable), `shareLinks.lastRedeemedAt` (`instant()`, nullable), `boardMembers.joinedByLink` (boolean, not null, default `false`).

- [ ] **Step 1: Failing test** in `schema.test.ts`: after migrations, inserting a `share_links` row with `expiry = 'DAYS_90'` violates `share_links_expiry_check`; a `board_members` row inserted without `joined_by_link` reads back `false`; a `share_links` row inserted _before_ the migration (use the harness's migrate-to-version helper if it has one; otherwise test the backfill SQL directly on a row with null `expires_at`) gets `expiry = 'DAYS_30'` and `expires_at` within a second of `now() + 30 days`.
- [ ] **Step 2:** Run it → FAIL.
- [ ] **Step 3:** Add the columns; `pnpm --filter @wally/api db:generate --name share_link_expiry`; append to the generated SQL, after a `--> statement-breakpoint`: `update share_links set expires_at = now() + interval '30 days' where expiry = 'DAYS_30' and expires_at is null;` Update `seed.ts` so seeded links carry `expiry`/`expiresAt` and seeded members `joinedByLink: false`.
- [ ] **Step 4:** Test PASS; `pnpm --filter @wally/api test test/seed.test.ts` PASS.
- [ ] **Step 5:** Commit `feat(api): share-link expiry and link-member columns`.

### Task 3: Share-link commands (create, update, rotate, delete, read)

**Files:**

- Modify: `apps/api/src/lib/commands/administration.ts` (the `link.*` branch), `apps/api/src/lib/commands/queries.ts` (`getShareLink`), `apps/api/src/lib/dto.ts` (`toShareLinkDto`), `apps/api/src/routes/boards.ts` if it builds the inputs
- Test: `apps/api/test/share-links.test.ts`

**Interfaces — Consumes:** Task 1 schemas and `shareLinkExpiresAt`, `isShareLinkLive`. **Produces:** `removeLinkMembers(tx: Transaction, boardId: string): Promise<string[]>` in `administration.ts` (deletes the board's `joined_by_link = true` rows, returns the removed user ids that no longer hold any `ACTIVE` row on the board); callers enqueue one `member.remove` cleanup job per id with the existing `enqueueCleanup`.

Behaviour (spec, "Share links" and "Members who joined through a link"):

- `link.create`: stores `expiry` and `expiresAt = shareLinkExpiresAt(expiry, now)`. An existing row that is not live counts as absent (replace it, removing its link members first) instead of 409.
- `link.update`: `role` only → `expiresAt` unchanged; `expiry` given → `expiry` stored, `expiresAt` restarted from now. Link members' roles are not changed.
- `link.rotate`: new token, same `expiry`, `expiresAt` restarted, `lastRedeemedAt` null; `removeLinkMembers` + cleanup jobs.
- `link.delete`: `removeLinkMembers` + cleanup jobs, then delete.
- Any command that removes link members bumps the board revision.
- `getShareLink`: a non-live row → 404.
- `toShareLinkDto` adds `expiry`, `expiresAt?.toISOString() ?? null`, `lastRedeemedAt?.toISOString() ?? null`.
- How the cleanup ids reach `executeCommand` (`commands/index.ts` drains one `result.cleanupId` today): either return several and drain each, or enqueue them and drain in a loop there — implementer's choice; the test below decides correctness.

- [ ] **Step 1: Failing tests** in `share-links.test.ts`:
  - `create defaults to 30 days`: no `expiry` → DTO `expiry: 'DAYS_30'`, `expiresAt` = now + 30 d (fake clock).
  - `create with NEVER has no expiry`: `expiresAt: null`.
  - `role-only update keeps expiresAt`; `expiry update restarts the clock`.
  - `rotate keeps expiry, restarts expiresAt, clears lastRedeemedAt`.
  - `rotate removes members who joined by link and releases their assignments`: a link member assigned to a shared note and a private note → after rotate they get 404 on the board, the shared note's `assigneeId` is null, the private note's is unchanged; a member with `joined_by_link = false` keeps access.
  - `delete removes link members` (same assertions, shorter).
  - `an expired link reads as no link`: advance past `expiresAt` → GET share link 404; `create` then succeeds with 201.
- [ ] **Step 2:** Run `pnpm --filter @wally/api test test/share-links.test.ts` → the new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** File PASS.
- [ ] **Step 5:** Commit `feat(api): share links expire; rotating or turning off a link removes its members`.

### Task 4: Redeem and invite — who joins how

**Files:**

- Modify: `apps/api/src/lib/commands/administration.ts` (`member.invite` and `link.redeem` branches, the member upsert's `onConflictDoUpdate`), `apps/api/src/lib/dto.ts` (`toMemberDto`)
- Test: `apps/api/test/share-links.test.ts`, `apps/api/test/invite-security.test.ts`

**Interfaces — Consumes:** `isShareLinkLive`, `isPendingInviteLive`.

Behaviour:

- `link.redeem`: a link that is not live → the existing 404, **before** the owner shortcut. Matching rows ignore pending invites that are not live. A newly created row gets `joinedByLink: true`; an existing `ACTIVE` row keeps its flag; a claimed pending invite gets `false`. A non-owner success sets `share_links.last_redeemed_at = now`.
- `member.invite`: a new row as today; an existing row also gets `invitedAt = now` if still `PENDING`, and `joinedByLink = false` always. The upsert's `set` includes `invitedAt` and `joinedByLink`.
- `toMemberDto` adds `invitedAt: member.invitedAt.toISOString()` and `joinedByLink: member.joinedByLink`.

- [ ] **Step 1: Failing tests:**
  - `owner gets 404 on their own expired link`.
  - `redeem works one second before expiry and fails at expiry`.
  - `redeem marks a new member as joined by link and records lastRedeemedAt`; `the owner redeeming does not set lastRedeemedAt`.
  - `claiming a pending invite through a link clears joinedByLink`.
  - `an expired pending invite cannot be claimed through a link` (invite at t, redeem at t + 30 d → member gets only the link's role, flag `true`).
  - `re-inviting a pending address restarts invitedAt` (invite-security).
  - `inviting a link member by email makes them permanent` → flag `false`, and they survive a later rotate.
- [ ] **Step 2:** Run both files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Both PASS.
- [ ] **Step 5:** Commit `feat(api): redeem honours expiry; members record whether they joined by link`.

### Task 5: Access ends at expiry, before any purge

**Files:**

- Modify: `apps/api/src/lib/db/records.ts` (`boardColumns.memberRoles`), `apps/api/src/lib/commands/queries.ts` (`listBoards` join, `listMembers`), `apps/api/src/lib/members.ts` (`activatePendingInvitesForEmail`)
- Test: `apps/api/test/membership-integrity.test.ts`, `apps/api/test/invite-security.test.ts`, `apps/api/test/mcp.test.ts`

Behaviour:

- `memberRoles` SQL adds: `and (not m.joined_by_link or exists (select 1 from share_links l where l.board_id = whiteboards.id and (l.expires_at is null or l.expires_at > now())))`. Every access check (`requireAccess`, `listBoards`'s final filter, MCP) already goes through `memberRoles`, so this is the one change that ends access.
- `listMembers` leaves out link members of a non-live link and `PENDING` rows whose invite is not live.
- `activatePendingInvitesForEmail` selects only `PENDING` rows with `invited_at > pendingInviteCutoff(now)`, and re-checks it on the fresh row.

- [ ] **Step 1: Failing tests:**
  - `a link member loses access the second the link expires` (no purge run): board GET 404, board missing from the list, MCP read refused.
  - `the member list hides expired invites and members of an expired link`.
  - `signing in with a verified email does not activate an invite older than 30 days`; `does activate one 30 days minus a second old`.
- [ ] **Step 2:** Run the three files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS, and the full API suite `pnpm --filter @wally/api test` PASS.
- [ ] **Step 5:** Commit `feat(api): access through an expired link or invite ends at expiry`.

### Task 6: `purge_expired()` deletes what has expired

**Files:**

- Create: `apps/api/drizzle/<N+1>_purge_retention.sql` (`pnpm --filter @wally/api exec drizzle-kit generate --custom --name purge_retention`)
- Modify: `apps/api/src/lib/db/purge.ts` (`TABLES` and its doc comment), `apps/api/src/maintenance.ts` comment
- Test: `apps/api/src/lib/db/purge.test.ts`

The migration does `create or replace function purge_expired(at timestamptz default now())` with the **current** body from Task 0 (loop and every table the deletion work added) plus, after the loop, each returning one `(table_name, deleted)` row:

1. **`share_link_members`** — for each board whose link has `expires_at <= at`: delete its `board_members` rows with `joined_by_link`; for each removed user who is not the owner and holds no remaining `ACTIVE` row on the board, `update notes set assignee_id = null, updated_at = at, revision = revision + 1 where board_id = … and assignee_id = … and deleted_at is null and visibility <> 'PRIVATE'` (the same rule as `drainCleanupJob`'s `member.remove`); bump `whiteboards.revision` and `updated_at` for each affected board. Count = member rows deleted.
2. **`share_links`** — `delete from share_links where expires_at <= at`.
3. **`board_members`** — `delete … where status = 'PENDING' and invited_at <= at - interval '30 days'`.
4. **`assistant_usage`** — `delete … where day < (at - interval '12 months')::date`.

Keep the existing `revoke execute` line after the `create or replace`. The pg_cron schedule needs no change.

`TABLES` gains `share_link_members: 'shareLinkMembers'`, `share_links: 'shareLinks'`, `board_members: 'pendingInvites'`, `assistant_usage: 'assistantUsage'`.

- [ ] **Step 1: Failing tests** in `purge.test.ts`:
  - `deletes an expired link and its link members, releasing shared assignments only`; a `NEVER` link and a live link are untouched; a `joined_by_link = false` member of the expired board is untouched; the board revision went up.
  - `deletes pending invites at 30 days, not 30 days minus a second, and never ACTIVE rows`.
  - `deletes usage rows older than 12 months and keeps the 12-month day`.
  - `the SQL periods match retention.ts`: read the migration file's text and assert it contains `interval '${PENDING_INVITE_DAYS} days'` and `interval '${ASSISTANT_USAGE_MONTHS} months'`.
  - The existing tests still pass (no deletion-work table lost from the result).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; `pnpm --filter @wally/api test` PASS.
- [ ] **Step 5:** Commit `feat(api): the hourly purge removes expired links, their members, old invites and usage`.

### Task 7: Web — expiry choice, dates, link members

**Files:**

- Modify: `apps/web/src/features/board/Share/ShareLinkControls.tsx`, `apps/web/src/features/board/Share/MemberList.tsx`, `apps/web/src/features/board/hooks/mutations/useShareLinkMutations.ts`, `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/de.ts`, `apps/web/src/test/fixtures.ts`
- Test: `apps/web/src/features/board/Share/ShareSheet.test.tsx`

**Interfaces — Consumes:** Task 1 DTOs and command inputs.

Behaviour (spec, "Web" under share links and link members):

- An expiry select (7 days / 30 days / Never; 30 pre-selected) when creating a link and on an existing link; changing it sends `link.update` with `{ expiry }`.
- Under the link: "Expires on {date}" or "Never expires"; "Last used {date}" or "Not used yet"; and "People who joined through this link lose access when it expires, is regenerated or turned off." Dates via the existing locale date formatter, date only.
- The Regenerate and Turn off controls carry the same warning (in their confirmation if one exists, otherwise as the hint above).
- Member list: a `PENDING` member shows "Invite expires on {invitedAt + 30 days}" instead of "Pending"; a member with `joinedByLink` shows "Joined by link".
- English copy as above; German: "Läuft ab am {date}", "Läuft nie ab", "Zuletzt benutzt am {date}", "Noch nicht benutzt", "Wer über diesen Link beigetreten ist, verliert den Zugang, wenn er abläuft, neu erstellt oder deaktiviert wird.", "Einladung läuft ab am {date}", "Über Link beigetreten", select options "7 Tage", "30 Tage", "Nie". The 30-day invite period is `PENDING_INVITE_DAYS` from `@wally/shared`.

- [ ] **Step 1: Failing tests** in `ShareSheet.test.tsx`: the select defaults to 30 days and creating sends `expiry: 'DAYS_30'`; choosing Never sends `link.update` `{ expiry: 'NEVER' }`; the expiry, last-used and warning lines render from a fixture; a pending member shows the expiry date; a `joinedByLink` member shows the label.
- [ ] **Step 2:** `pnpm --filter @wally/web test src/features/board/Share` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; `pnpm --filter @wally/web test` and `pnpm typecheck` PASS.
- [ ] **Step 5:** Commit `feat(web): choose a share link's expiry; see when it expires, was last used, and who joined by it`.

### Task 8: E2E

**Files:** Modify `apps/web/e2e/share.spec.ts`.

- [ ] **Step 1:** Replace the `Ausstehend` (Pending) assertion with the invite-expiry line. Add: create a link with "7 Tage" and see "Läuft ab am" with today + 7 days; switch to "Nie" and see "Läuft nie ab". No second-user step (owner, 2026-11-04).
- [ ] **Step 2:** Run locally against the dev stack per `apps/web/e2e/README.md` → PASS. (Per the project rule, the CI run is the one that counts.)
- [ ] **Step 3:** Commit `test(e2e): share-link expiry choice and invite expiry line`.

### Task 9: Vendor retention research, GDPR.md and the privacy notice

**Files:**

- Modify: `docs/GDPR.md`, `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/de.ts` (`privacy.*` retention paragraph), `apps/web/src/i18n/privacyProviders.test.ts` if it asserts the text
- Create: none (findings go straight into GDPR.md)

- [ ] **Step 1: Research.** For each item in the spec's "Vendor retention" list, find the vendor's own documentation, record the URL and the date checked, and check Wally's actual setting (Auth0 dashboard, `gcloud logging buckets describe _Default --location=global --project=luminull-wally`, Cloudflare dashboard, Supabase dashboard — ask the owner for any console you cannot reach). Anything not verifiable is "unverified" with what was checked. Settings Wally could change but the owner has not decided become PR questions.
- [ ] **Step 2: GDPR.md.** §2 gains a "Retention" table: one row per data kind — Wally's tables from the spec's decision table, then the vendor rows — with period, what deletes it, and the source. Record the owner's reason for notes and history. Mark GAP-04 and GAP-06 resolved; GAP-07 resolved for retention with the invitation-email notice still open; GAP-08's retention half settled. Update the `share_links` and `board_members` inventory rows. Fix the deletion design's "Invite expiry is GAP-06" reference if it was merged unchanged.
- [ ] **Step 3: Privacy notice.** Rewrite the retention paragraph in `en.ts` and `de.ts` per the spec, replacing "provider backups may follow separate retention schedules; contact us for details" with the verified periods. Keep the rest of the paragraph the deletion work left.
- [ ] **Step 4:** `pnpm --filter @wally/web test` PASS; `pnpm exec prettier --check docs` PASS.
- [ ] **Step 5:** Commit `docs: retention policy in GDPR.md, vendors included; privacy notice states the periods`.

### Task 10: Whole-branch review and PR

- [ ] **Step 1:** One fresh reviewer (most capable model) reviews the whole branch against the spec; fix what it confirms.
- [ ] **Step 2:** Full `make test` (or documented equivalent) PASS.
- [ ] **Step 3:** Ask the owner before pushing. On yes: push, open the PR (body ends with the attribution line), and let CI (including E2E) go green before calling it ready. The PR body lists any vendor-retention questions from Task 9.
