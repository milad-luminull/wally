# Retention (GDPR GAP-04, GAP-06, GAP-07) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share links expire (7 days, 30 days or never) and their members go with them, pending invites go after 30 days, assistant usage counters after 30 days, and GDPR.md and the privacy notice state the periods. Vendors follow in a second, docs-only PR (Task 6).

**Architecture:** Two columns (`share_links.expires_at`, `board_members.joined_by_link`). The existing hourly `purge_expired()` job does all deleting; the only runtime expiry check is in `link.redeem`. Two SQL functions, `release_assignments()` (today's `member.remove` rule, moved so it exists once) and `remove_link_members()`, are shared by the link commands, `drainCleanupJob` and the hourly job.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM 0.45 + drizzle-kit 0.31, PostgreSQL (Supabase, pg_cron), Zod (`@wally/shared`), React + TanStack Query, i18next, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-11-04-gdpr-retention-design.md](../specs/2026-11-04-gdpr-retention-design.md)

## Global Constraints

- **Start only after the account deletion PR (branch `docs/account-deletion-export`) is merged to `main`.** Branch from that `main`. This plan's two migrations take the next two free numbers (expected `0004`, `0005`) and keep everything the deletion work put into `purge_expired()`.
- Keep it small: no expiry checks outside `link.redeem`, no new helper modules, no new UI beyond the spec's "Web" section. If a step seems to need more, stop and ask.
- Durations offered: `DAYS_7`, `DAYS_30` (default), `NEVER`; only the resulting `expires_at` is stored (null = never).
- Existing share links get `expires_at = now() + interval '30 days'` in the migration; existing members `joined_by_link = false`.
- Periods: invites `invited_at <= at - interval '30 days'`; usage `day < (at - interval '30 days')::date` (owner switched from 12 months to 30 days on 2026-11-04). Written in the migration only.
- English identifiers and stored values; German only in `de.ts` (ADR-0014). i18next placeholders are `{{name}}`.
- Never log a share-link token.
- Tests write past timestamps and pass explicit `at` to `purge_expired()`; never fake the clock for database expiry.
- No stacked PRs; E2E spec changes in this PR; CI green before ready; no push or PR without the owner's go-ahead.

## Review Focus

1. **The owner opens their own expired link** → 404; the expiry check comes before the owner shortcut. Test in Task 2.
2. **A link member who later accepted an email invite** (`joined_by_link = false`) → survives rotate, delete and the hourly job. Tests in Tasks 2 and 3.
3. **The release** → no existing member loses access; existing links get 30 days. Test in Task 1.
4. **Private notes of a removed link member** stay assigned and hidden. Test in Task 1.
5. **Existing member-removal behaviour** is unchanged after `drainCleanupJob` switches to `release_assignments`. Existing tests in Task 1.

---

### Task 0: Rebase onto the merged deletion work

- [ ] **Step 1:** Confirm the deletion PR is merged, then `git rebase origin/main` this branch (it holds only the spec and this plan).
- [ ] **Step 2:** Note the next two free migration numbers (`apps/api/drizzle/meta/_journal.json`) and the current `purge_expired()` body (the newest migration that defines it).
- [ ] **Step 3:** The full test suite passes before any change.

### Task 1: Columns and the two database functions

**Files:**

- Modify: `apps/api/src/lib/postgres/schema/boards.ts`, `apps/api/src/lib/commands/maintenance.ts`, `apps/api/src/seed.ts`
- Create: `apps/api/drizzle/<N>_share_link_expiry.sql` (generated, backfill appended) and `apps/api/drizzle/<N+1>_retention.sql` (`drizzle-kit generate --custom --name retention`; Task 3 adds to it — safe, it is unreleased), with snapshots and journal entries
- Test: `apps/api/src/lib/postgres/schema/link-members.test.ts`

**Interfaces — Produces:** `shareLinks.expiresAt` (`instant()`, nullable); `boardMembers.joinedByLink` (boolean, not null, default false). SQL, each followed by `revoke execute … from public, anon, authenticated, service_role` (as for `purge_expired()`; use the id columns' real types):

- `release_assignments(board text, member text, at timestamptz) returns integer` — if `member` is not the owner and holds no `ACTIVE` row on the board: `update notes set assignee_id = null, updated_at = at, revision = revision + 1 where board_id = board and assignee_id = member and deleted_at is null and visibility <> 'PRIVATE'`; returns rows changed.
- `remove_link_members(board text, at timestamptz) returns integer` — deletes the board's `joined_by_link` rows, calls `release_assignments` per distinct removed user, returns rows deleted. Does not bump the board revision.

- [ ] **Step 1: Failing tests** in `link-members.test.ts`: `release_assignments` unassigns shared notes, leaves a private note assigned, does nothing for the owner or for someone still holding an `ACTIVE` row; `remove_link_members` deletes only that board's `joined_by_link` rows and returns the count; a member row inserted without `joined_by_link` reads `false`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add the columns; `pnpm --filter @wally/api db:generate --name share_link_expiry`; append `update share_links set expires_at = now() + interval '30 days';` after a `--> statement-breakpoint`. Write both functions in the custom migration. In `drainCleanupJob`'s `member.remove` branch replace the update with ``tx.execute(sql`select release_assignments(${job.boardId}, ${job.userId}, ${new Date()})`)``. Seed: links get an `expiresAt`, members `joinedByLink: false`.
- [ ] **Step 4:** New tests PASS; `pnpm --filter @wally/api test` PASS (existing member-removal tests unchanged).
- [ ] **Step 5:** Commit `feat(api): share-link expiry and link-member columns; release_assignments() and remove_link_members()`.

### Task 2: Contract and link commands

**Files:**

- Modify: `packages/shared/src/enums.ts`, `packages/shared/src/schemas/member.ts`, `packages/shared/src/schemas/command.ts`, `apps/api/src/lib/commands/administration.ts`, `apps/api/src/lib/dto.ts`, `apps/api/src/routes/boards.ts` if it builds the inputs
- Test: `apps/api/test/share-links.test.ts`, `apps/api/test/invite-security.test.ts`

**Interfaces — Produces:** `shareLinkDurationValues = ['DAYS_7', 'DAYS_30', 'NEVER'] as const` and `shareLinkDurationSchema`; `link.create` input `{ role, expiresIn: shareLinkDurationSchema.default('DAYS_30') }`; `link.update` input `{ role?, expiresIn? }` (at least one); `ShareLinkDto.expiresAt: string | null`; `MemberDto.joinedByLink: boolean`. A local `const DURATION_DAYS = { DAYS_7: 7, DAYS_30: 30, NEVER: null }` in `administration.ts`. **Consumes:** Task 1's `remove_link_members`, called as ``tx.execute(sql`select remove_link_members(${board.id}, ${timestamp})`)``.

Behaviour:

- `link.create`: `expiresAt` from `expiresIn` and now.
- `link.update`: `expiresIn` given → `expiresAt` from now; role only → unchanged.
- `link.rotate`: `remove_link_members`, new token, same `expiresAt`. `link.delete`: `remove_link_members`, delete. Both already bump the board revision via `updateBoard()`.
- `link.redeem`: the link lookup adds `expires_at is null or expires_at > now()` (so an expired link is the existing 404, before the owner shortcut). A new row gets `joinedByLink: true`; a claimed pending invite `false`; an existing row keeps its value.
- `member.invite` on an existing row sets `joinedByLink = false`; the upsert's `set` includes `joinedByLink`.
- `toShareLinkDto` adds `expiresAt: link.expiresAt?.toISOString() ?? null`; `toMemberDto` adds `joinedByLink`.

- [ ] **Step 1: Failing tests:** `create defaults to 30 days` and `NEVER stores null`; `role-only update keeps expiresAt`; `expiresIn update counts from now`; `rotate and delete remove link members and unassign their shared notes, keep joined_by_link = false members`; `rotate keeps expiresAt`; `redeem fails one second past expiry and works one second before` (set `expires_at` in the database); `owner gets 404 on their own expired link`; `redeem marks a new member joined by link`; `claiming a pending invite through a link clears the flag`; `an email invite makes a link member permanent` (invite-security).
- [ ] **Step 2:** Run both files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; `pnpm --filter @wally/shared test` and `pnpm typecheck` (web errors expected until Task 4; list them in the commit body).
- [ ] **Step 5:** Commit `feat(api): share links expire and take their members with them`.

### Task 3: The hourly job

**Files:**

- Modify: `apps/api/drizzle/<N+1>_retention.sql`, `apps/api/src/lib/db/purge.ts` (`TABLES`, doc comment), `apps/api/src/maintenance.ts` comment
- Test: `apps/api/src/lib/db/purge.test.ts`

Append `create or replace function purge_expired(at timestamptz default now())` with the **current** body (Task 0) plus, after the loop, one `(table_name, deleted)` row each:

1. `share_links` — for each board whose link has `expires_at <= at`: `remove_link_members(board, at)`, bump `whiteboards.revision`/`updated_at` if it removed anyone, delete the link. Count = links deleted.
2. `board_members` — delete `PENDING` rows with `invited_at <= at - interval '30 days'`.
3. `assistant_usage` — delete rows with `day < (at - interval '30 days')::date`.

Then the existing `revoke execute` line. `TABLES` gains `share_links: 'shareLinks'`, `board_members: 'pendingInvites'`, `assistant_usage: 'assistantUsage'`.

- [ ] **Step 1: Failing tests:** an expired link and its link members go, shared assignments released; live and never-expiring links, and `joined_by_link = false` members, stay; the board revision went up. Invites go at exactly 30 days, not a second earlier, never `ACTIVE` rows. Usage older than 30 days goes, the boundary day stays. Existing purge tests still pass.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; `pnpm --filter @wally/api test` PASS.
- [ ] **Step 5:** Commit `feat(api): the hourly job removes expired links and their members, old invites and old usage`.

### Task 4: Web and E2E

**Files:**

- Modify: `apps/web/src/features/board/Share/ShareLinkControls.tsx`, `apps/web/src/features/board/Share/MemberList.tsx`, `apps/web/src/features/board/hooks/mutations/useShareLinkMutations.ts`, `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/de.ts`, `apps/web/src/test/fixtures.ts`, `apps/web/e2e/share.spec.ts`
- Test: `apps/web/src/features/board/Share/ShareSheet.test.tsx`

Behaviour (spec, "Web"): a duration select on create (30 days pre-selected); on an existing link "Expires on {{date}}" / "Never expires" and a "Change expiry" select sending `link.update { expiresIn }`; one warning line under the link; the member list shows "Joined by link" under a `joinedByLink` member (German: "Über den Link beigetreten"). Dates via the existing locale formatter, date only. German: "7 Tage", "30 Tage", "Nie", "Läuft ab am {{date}}", "Läuft nie ab", "Ablauf ändern", "Wer über diesen Link beigetreten ist, verliert den Zugang, wenn der Link abläuft, neu erstellt oder deaktiviert wird."

- [ ] **Step 1: Failing tests** in `ShareSheet.test.tsx`: create sends `expiresIn: 'DAYS_30'` by default; changing to never sends `link.update { expiresIn: 'NEVER' }`; the expiry and warning lines render; a `joinedByLink` member shows the label.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. In `share.spec.ts`: create a link with "7 Tage", see "Läuft ab am" with today + 7 days; change to "Nie", see "Läuft nie ab".
- [ ] **Step 4:** `pnpm --filter @wally/web test` and `pnpm typecheck` PASS; E2E locally per `apps/web/e2e/README.md` (CI is the run that counts).
- [ ] **Step 5:** Commit `feat(web): choose and change a share link's expiry; label members who joined by link`.

### Task 5: Docs, review, PR

**Files:** `docs/GDPR.md`, `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/de.ts` (`privacy.*`), `apps/web/src/i18n/privacyProviders.test.ts` if it asserts the text.

- [ ] **Step 1:** Ask the owner the spec's open question (purpose of 12-month usage counters). If they switch to 30 days, change the one number in the migration and its test.
- [ ] **Step 2:** GDPR.md per the spec's "Docs" section (retention table for Wally's data, reasons, gap statuses, inventory rows; "vendors: to follow"). Fix the deletion design's "Invite expiry is GAP-06" if merged unchanged.
- [ ] **Step 3:** Privacy notice retention paragraph in `en.ts` and `de.ts`.
- [ ] **Step 4:** One fresh reviewer (most capable model) reviews the whole branch against the spec, including the "leaves out on purpose" list; fix what it confirms. Full test suite PASS.
- [ ] **Step 5:** Ask the owner before pushing. On yes: push, open the PR (body ends with the attribution line), CI green including E2E before ready.

### Task 6: Vendors — a second, docs-only PR after Task 5's PR merges

- [ ] **Step 1:** For Auth0, Google Cloud (Cloud Run logs, Vertex AI), Cloudflare and Supabase: what each holds of Wally's users, a link to the vendor's own retention documentation (checked on the day, date noted), and Wally's setting only where Wally configures one (for example the `_Default` log bucket: `gcloud logging buckets describe _Default --location=global --project=luminull-wally`). Plus the deletion work's `deleted_identities` rows. Unchecked items are marked unverified. Ask the owner for consoles you cannot reach.
- [ ] **Step 2:** Add the rows to GDPR.md; replace the privacy notice's "provider backups may follow separate retention schedules; contact us for details" with a sentence naming the vendors and that their own retention applies.
- [ ] **Step 3:** Open decisions (settings Wally could change) go in the PR body as questions. Ask the owner before pushing; docs only, so E2E is skipped (ADR-0012).
