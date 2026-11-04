# Account deletion and data export — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person deletes their own account at once, or downloads everything they
can see as one JSON file; GDPR GAP-01 and GAP-02 close.

**Architecture:** Foreign keys with `on delete` actions do the erasing. `DELETE /me` deletes
the Auth0 user first (outside any transaction), then runs three statements in one
`withTransaction`. A one-hour `deleted_identities` row stops a still-valid token from
re-creating the account. `GET /me/export` assembles the existing query results and DTOs.

**Tech stack:** Fastify 5, Drizzle 0.45 / drizzle-kit 0.31, PostgreSQL 17 (Supabase), Zod,
React + react-i18next, Playwright.

**Spec:** [2026-11-03-account-deletion-and-export-design.md](../specs/2026-11-03-account-deletion-and-export-design.md)

## Global constraints

- English identifiers, enum values and test data; German only in `apps/web/src/i18n/de.ts`.
- Work on branch `docs/account-deletion-export` (it holds the design and this plan); one PR,
  not stacked. CI green, including E2E, before it is marked ready.
- Never `docker compose down -v`. Tests run in the dev container:
  `docker compose run --rm --no-deps -T api sh -c 'cd apps/api && npx vitest run <file>'`
  (from a worktree, symlink `../wally/.env` first and pass `-p wally`).
- Migrations are additive and new: production has applied `0000` and `0001`, so never
  regenerate them (`drizzle.config.ts`).
- The tombstone lasts **1 hour**. The Auth0 call happens **outside** `withTransaction`.
- Errors named here: `ACCOUNT_DELETED` (401), `ACCOUNT_DELETE_FAILED` (502).
- Owner input needed before Task 3's constant is final: the Auth0 Management API
  **Identifier** (Auth0 Dashboard > Applications > APIs > Auth0 Management API), of the form
  `https://<tenant default domain>/api/v2/`. Ask the owner; do not guess it.

## Review focus

1. **A private note created by the person:** deleting the account must not trip the
   private-note check constraint (their notes are deleted before the `users` row). Task 1 test.
2. **A note they created that others' notes link to:** the link is removed from the other
   note's view (links filter by visibility). Task 2 test.
3. **The typed email differs only in case or surrounding spaces:** it still unlocks the
   button (emails are stored lowercase). Task 6 test.
4. **A request already in flight with the old token after the deletion commits:** a write
   fails on the foreign key, a read finds no user (401). Task 4 test for the read path.
5. **Export with a board whose other member has private notes:** those notes never appear.
   Task 5 test.

---

### Task 1: Foreign keys, the tombstone table, and its expiry

**Files:**

- Modify: `apps/api/src/lib/postgres/schema/boards.ts` (`whiteboards.ownerId`, `boardMembers.userId`)
- Modify: `apps/api/src/lib/postgres/schema/notes.ts` (`createdById`, `assigneeId`, `noteHistory.actorId`)
- Modify: `apps/api/src/lib/postgres/schema/safety.ts` (`assistantAudit.actorId`)
- Modify: `apps/api/src/lib/postgres/schema/accounts.ts` (new `deletedIdentities`)
- Create: `apps/api/drizzle/0002_*.sql` (generated) and `apps/api/drizzle/0003_purge_deleted_identities.sql` (custom)
- Modify: `apps/api/src/lib/db/purge.ts` (`TABLES`)
- Test: `apps/api/src/lib/postgres/schema/user-deletion.test.ts` (new), `apps/api/src/lib/db/purge.test.ts`

**Interfaces:**

- Produces: `deletedIdentities` table `deleted_identities(issuer text, subject text, expires_at timestamptz)`, primary key `(issuer, subject)`, index on `expires_at`, RLS enabled like every table.
- Produces: `PurgeCounts.deletedIdentities`.

- [ ] **Step 1: Write the failing schema test** `user-deletion.test.ts`, using the per-file test database (`createTestDatabase`). Seed users `owner`, `member`, `other`; a board `b-own` owned by `owner` with `member` active; a board `b-other` owned by `other` with `owner` active. On `b-other`: note `n-mine` created by `owner`; private note `n-private` created by and assigned to `owner`; note `n-assigned` created by `other`, assigned to `owner`; a history row on `n-assigned` with `actorId = 'owner'` and one with `actorId = 'other'`. One `assistant_audit` row with `actorId = 'owner'`, one with `'other'`. Then run `delete from notes where created_by_id = 'owner'` and `delete from users where id = 'owner'`, and assert:

```ts
expect(await boardIds(db)).toEqual(['b-other']); // b-own gone for everyone
expect(await noteIds(db)).toEqual(['n-assigned']); // n-mine, n-private gone
expect((await note(db, 'n-assigned')).assigneeId).toBeNull();
expect(await historyActors(db, 'n-assigned')).toEqual(['other']);
expect(await memberUserIds(db, 'b-other')).not.toContain('owner');
expect(await auditActors(db)).toEqual(['other']);
```

Add `it('refuses a note whose creator does not exist')`: inserting a note with `createdById: 'ghost'` rejects with a foreign-key violation (`code: '23503'`).

- [ ] **Step 2: Run it; expect failures** (the user delete is refused by `whiteboards.owner_id`).

- [ ] **Step 3: Add the references:**
  - `whiteboards.ownerId`: `.references(() => users.id, { onDelete: 'cascade' })`
  - `boardMembers.userId`, `notes.createdById`, `noteHistory.actorId`, `assistantAudit.actorId`: `{ onDelete: 'cascade' }`
  - `notes.assigneeId`: `{ onDelete: 'set null' }`
  - `deletedIdentities` in `accounts.ts`, as in Interfaces.

- [ ] **Step 4: Generate the migration:** `pnpm --filter @wally/api db:generate`, then
      `pnpm --filter @wally/api exec drizzle-kit generate --custom --name purge_deleted_identities`
      and write in it `create or replace function purge_expired(...)` identical to `0001` with
      `'deleted_identities'` appended to `expiring`, followed by the same `revoke execute`
      statement. Add `deleted_identities: 'deletedIdentities'` to `TABLES` in `purge.ts`.

- [ ] **Step 5: Fix tests that insert rows referencing users who do not exist** (for example `boards-notes.test.ts` inserts history with `actorId: 'u1'`): give them the user row. Update `purge.test.ts` to expect seven tables and add an expired and a live `deleted_identities` row to its fixtures.

- [ ] **Step 6: Run the API suite** (`npx vitest run` in `apps/api`). Expected: all pass.

- [ ] **Step 7: Commit** `feat(db): user references cascade on delete; deleted_identities expires`.

### Task 2: `eraseAccount` and the tombstone check

**Files:**

- Create: `apps/api/src/lib/account/erase.ts`
- Modify: `apps/api/src/lib/auth/identities.ts` (`resolveOrCreateIdentity`)
- Test: `apps/api/test/account-deletion.test.ts` (new)

**Interfaces:**

- Consumes: `deletedIdentities` (Task 1).
- Produces: `export const TOMBSTONE_MS = 60 * 60 * 1000;`
- Produces: `export async function eraseAccount(db: Database, userId: string, identity: ExternalIdentity | null, now?: Date): Promise<void>` — one `withTransaction`: delete notes with `created_by_id = userId`; if `identity`, upsert `deleted_identities` with `expires_at = now + TOMBSTONE_MS`; delete the `users` row.
- Produces: `export async function accountIdentity(db: Database, userId: string): Promise<ExternalIdentity | null>` — the account's `auth_identities` row with `issuer = AUTH0_ISSUER` (one per account since #98).

- [ ] **Step 1: Write failing tests** with `buildTestApp` and `createBoardFixture`:
  - `it('erases the account, its boards for everyone, and its notes on other boards')`: after `eraseAccount(app.db, fx.ownerId, identity)`, the owner's board answers 404 to the EDIT member, and a note the owner created on another user's board is gone from that board's `GET /whiteboards/:id/notes`.
  - `it('drops links to the erased notes from notes that stay')`: a note by `other` that linked to the erased note lists no link.
  - `it('leaves a pending invite to the address in place')`.
  - `it('refuses a new account for a tombstoned identity until it expires')`: with `auth0SignupEnabled: true`, the old token gets `401 ACCOUNT_DELETED` and no `users` row appears; after `purgeExpired(db, now + 2h)` the same token creates a new account.

- [ ] **Step 2: Run; expect failures** (module missing).

- [ ] **Step 3: Implement `erase.ts`** as in Interfaces. In `resolveOrCreateIdentity`, after the mapping miss and before the email collision check, select from `deletedIdentities` by issuer and subject with `expires_at > now()`; if found, throw `new AppError(401, 'ACCOUNT_DELETED', 'This account was deleted')`.

- [ ] **Step 4: Run; expect pass.**

- [ ] **Step 5: Commit** `feat(api): erase an account in one transaction, with a one-hour tombstone`.

### Task 3: Auth0 Management client and its configuration

**Files:**

- Create: `apps/api/src/lib/auth/management.ts`, `apps/api/src/lib/auth/management.test.ts`
- Modify: `apps/api/src/lib/auth/constants.ts`, `apps/api/src/env.ts`
- Modify: `scripts/resolve-release-image.mjs`, `scripts/resolve-release-image.test.mjs`, `.github/workflows/release.yml`

**Interfaces:**

- Produces: `export const AUTH0_MANAGEMENT_AUDIENCE = '<the owner-supplied Identifier>';` in `constants.ts`.
- Produces: `export interface Auth0UserDeleter { deleteUser(subject: string): Promise<void> }`
- Produces: `export function createAuth0UserDeleter(options: { clientId: string; clientSecret: string; fetch?: typeof fetch }): Auth0UserDeleter`
- Produces: `Env.AUTH0_MANAGEMENT_CLIENT_ID?: string`, `Env.AUTH0_MANAGEMENT_CLIENT_SECRET?: string`.

- [ ] **Step 1: Write failing tests** in `management.test.ts` with a fake `fetch`:
  - `it('gets a token, then deletes the user')`: first call `POST https://login.luminull.com/oauth/token` with JSON body `{ grant_type: 'client_credentials', client_id, client_secret, audience: AUTH0_MANAGEMENT_AUDIENCE }`; second call `DELETE https://login.luminull.com/api/v2/users/auth0%7Cabc` with `authorization: Bearer <token>`; resolves on 204.
  - `it('throws on any answer but 204')`: 404 and 500 each reject, and the error message names the status, never the token or the secret.
  - `it('asks for a new token on every deletion')`: two deletions make two token calls.
  - In `env.test.ts` (or the existing env tests): one setting without the other throws; `NODE_ENV=production` without both throws `AUTH0_MANAGEMENT_CLIENT_ID and AUTH0_MANAGEMENT_CLIENT_SECRET are required in production`; development without either passes.
  - In `resolve-release-image.test.mjs`: `apiConfig` includes `AUTH0_MANAGEMENT_CLIENT_ID` in `env`, and `{ name: 'AUTH0_MANAGEMENT_CLIENT_SECRET', secret: 'wally-auth0-management-client-secret', version: 'latest' }` in `secrets`; a missing client ID throws `Missing candidate configuration`.

- [ ] **Step 2: Run; expect failures.**

- [ ] **Step 3: Implement.** Each request uses `AbortSignal.timeout(10_000)`. `encodeURIComponent` the subject. The env checks go in `loadEnv`, beside the `ASSISTANT_VERTEX_PROJECT` check. In `release.yml`, pass `AUTH0_MANAGEMENT_CLIENT_ID: ${{ vars.AUTH0_MANAGEMENT_CLIENT_ID }}` to the step that calls `apiConfig`.

- [ ] **Step 4: Run** `management.test.ts`, the env tests and `node --test scripts/resolve-release-image.test.mjs`. Expected: pass.

- [ ] **Step 5: Commit** `feat(api): Auth0 Management client that deletes one user; production requires it`.

### Task 4: `DELETE /me`

**Files:**

- Modify: `apps/api/src/routes/me.ts`, `apps/api/src/app.ts` (`BuildAppOptions`)
- Test: `apps/api/test/account-deletion.test.ts`

**Interfaces:**

- Consumes: `eraseAccount`, `accountIdentity` (Task 2); `Auth0UserDeleter`, `createAuth0UserDeleter` (Task 3).
- Produces: `BuildAppOptions.auth0UserDeleter?: Auth0UserDeleter | null` — tests pass a fake or `null`; by default the app creates one when both settings are set, else `null`.
- Produces: `DELETE /me` → `204`, no body.

- [ ] **Step 1: Write failing route tests:**
  - `it('deletes the Auth0 user, then the account, and answers 204')`: fake deleter records `['auth0|owner-subject']`; afterwards the owner's `GET /me` answers 401.
  - `it('erases nothing when Auth0 fails')`: fake rejects; response `502 ACCOUNT_DELETE_FAILED`; the owner's `GET /me` still answers 200.
  - `it('skips Auth0 and logs it when no deleter is configured')`: `auth0UserDeleter: null`; 204; the log stream contains `auth0 step skipped`.
  - `it('logs the user id when the database step fails after Auth0')`: `vi.spyOn` the `erase.ts` module so `eraseAccount` rejects; response 500; the log line has `userId` and `auth0Deleted: true`.

- [ ] **Step 2: Run; expect failures.**

- [ ] **Step 3: Implement** in `me.ts`: `accountIdentity` → if a deleter and an identity, `await deleter.deleteUser(identity.subject)` (a rejection becomes `AppError(502, 'ACCOUNT_DELETE_FAILED', 'The account could not be deleted. Try again.')`), else `request.log.info('auth0 step skipped')`; then `eraseAccount(db, request.user.id, identity)`; on its failure `request.log.error({ userId, auth0Deleted }, 'account erase failed')` and rethrow. Reply `204`.

- [ ] **Step 4: Run** `account-deletion.test.ts` and `me.test.ts`; expect pass. MCP tokens never reach `/me`: the REST verifier accepts only `AUTH0_AUDIENCE`, already covered in `mcp.test.ts`.

- [ ] **Step 5: Commit** `feat(api): DELETE /me deletes the Auth0 user, then erases the account`.

### Task 5: `GET /me/export`

**Files:**

- Create: `packages/shared/src/schemas/accountExport.ts` (export from the package index)
- Create: `apps/api/src/lib/account/export.ts`
- Modify: `apps/api/src/routes/me.ts`
- Test: `apps/api/test/account-export.test.ts` (new)

**Interfaces:**

- Produces, in shared:

```ts
export const accountExportSchema = z.object({
  formatVersion: z.literal(1),
  exportedAt: z.string(),
  profile: meDtoSchema,
  boards: z.array(
    whiteboardSummaryDtoSchema.extend({
      members: z.array(memberDtoSchema),
      notes: z.array(noteDetailDtoSchema),
    }),
  ),
  connections: z.array(mcpConnectionSchema),
  assistant: z.object({
    usage: z.array(z.object({ day: z.string(), tokens: z.number() })),
    conversations: z.array(assistantConversationDtoSchema),
    suggestions: z.array(
      z.object({
        id: z.string(),
        boardId: z.string(),
        noteId: z.string(),
        status: z.string(),
        fields: z.unknown(),
        createdAt: z.string(),
      }),
    ),
    tidies: z.array(tidyDtoSchema),
  }),
});
export type AccountExport = z.infer<typeof accountExportSchema>;
```

- Produces: `export async function exportAccount(db: Database, user: FastifyRequest['user'], now?: Date): Promise<AccountExport>` — `listBoards`, then per board `listMembers(...).data` and `listNotes(db, user, id, { status: 'ALL' })`, plus one query each for the subtasks and the history of the listed note IDs, mapped with `toSubtaskDto` and the history mapper (export `toHistoryEventDto` from `dto.ts`). `listConnections`, `toConversationDto`, `toTidyDto` for the rest; the person's own rows only.
- Produces: `GET /me/export` → 200, `content-type: application/json`, `content-disposition: attachment; filename="wally-export-YYYY-MM-DD.json"` (UTC date of `exportedAt`).

- [ ] **Step 1: Write failing tests:** the owner's export contains their board with its members and a note with a subtask and its history; a note the EDIT member made private on that board is absent; a private note of the owner is present; `connections` lists an MCP connection created in the test; the body parses with `accountExportSchema`; the headers are as above.

- [ ] **Step 2: Run; expect failures.**

- [ ] **Step 3: Implement** as in Interfaces.

- [ ] **Step 4: Run; expect pass.**

- [ ] **Step 5: Commit** `feat(api): GET /me/export returns everything the account can see`.

### Task 6: The Account page

**Files:**

- Create: `apps/web/src/features/account/DeleteAccountDialog.tsx`, `apps/web/src/features/account/DeleteAccountDialog.test.tsx`
- Create: `apps/web/src/features/account/downloadExport.ts`
- Modify: `apps/web/src/routes/AccountPage.tsx`, `AccountPage.test.tsx`, `apps/web/src/routes/LoginPage.tsx`, `LoginPage.test.tsx`
- Modify: `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/de.ts`

**Interfaces:**

- Consumes: `DELETE /me`, `GET /me/export`, `accountExportSchema` (Tasks 4–5); existing `GET /whiteboards` and `GET /whiteboards/:id/members`; `useAuth().signOut`.
- Produces: `export const ACCOUNT_DELETED_FLAG = 'wally.accountDeleted';` (sessionStorage key) in `DeleteAccountDialog.tsx`.
- Produces: `export async function downloadExport(): Promise<void>` — `api.get('/me/export', accountExportSchema)`, then a `Blob` of `JSON.stringify(data, null, 2)` saved as `wally-export-${data.exportedAt.slice(0, 10)}.json` through a temporary `<a download>`.

Copy (`accountData` keys; replace `exportHint` and `deleteHint`):

| Key                | en                                                                                         | de                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `exportHint`       | Download everything you can see in Wally as one JSON file.                                 | Lade alles, was du in Wally siehst, als eine JSON-Datei herunter.                                         |
| `deleteHint`       | Deletes your account and everything you created, at once. This cannot be undone.           | Löscht dein Konto und alles, was du erstellt hast, sofort. Das lässt sich nicht rückgängig machen.        |
| `exportFailed`     | Your data could not be downloaded. Try again.                                              | Deine Daten konnten nicht heruntergeladen werden. Versuch es noch einmal.                                 |
| `deleteBoards`     | These boards are deleted for everyone:                                                     | Diese Wände werden für alle gelöscht:                                                                     |
| `deleteNoBoards`   | You own no boards.                                                                         | Du besitzt keine Wände.                                                                                   |
| `deleteSharedWith` | shared with {{names}}                                                                      | geteilt mit {{names}}                                                                                     |
| `deleteNotes`      | Your notes on other people's boards are deleted too. Cards you were only assigned to stay. | Deine Notizen auf fremden Wänden werden ebenfalls gelöscht. Karten, die dir nur zugewiesen sind, bleiben. |
| `deleteTypeEmail`  | Type {{email}} to confirm                                                                  | Gib {{email}} ein, um zu bestätigen                                                                       |
| `deleteConfirm`    | Delete my account                                                                          | Mein Konto löschen                                                                                        |
| `deleteFailed`     | Your account could not be deleted. Nothing was removed. Try again.                         | Dein Konto konnte nicht gelöscht werden. Es wurde nichts entfernt. Versuch es noch einmal.                |
| `deleted`          | Your account is deleted.                                                                   | Dein Konto ist gelöscht.                                                                                  |

- [ ] **Step 1: Write failing tests:**
  - `DeleteAccountDialog.test.tsx`: lists an owned board as "Team board — shared with Ada, Ben" (its members other than the owner, by display name, else email), omits a board where the role is EDIT; `deleteConfirm` stays disabled until the typed text equals the email ignoring case and surrounding spaces; on success it sets `ACCOUNT_DELETED_FLAG` and calls `signOut` once; on a 502 it shows `deleteFailed` and does not call `signOut`.
  - `AccountPage.test.tsx`: both buttons enabled; `download` calls `downloadExport`; a failure shows `exportFailed`.
  - `LoginPage.test.tsx`: with the flag set it shows `deleted` and removes the flag.

- [ ] **Step 2: Run** `pnpm --filter @wally/web exec vitest run src/features/account src/routes/AccountPage.test.tsx src/routes/LoginPage.test.tsx`; expect failures.

- [ ] **Step 3: Implement.** The dialog follows `DeleteBoardDialog.tsx` (`AlertDialog`). Before `signOut`, cancel and clear the query cache, so nothing refetches with the old token.

- [ ] **Step 4: Run the web suite; expect pass.**

- [ ] **Step 5: Commit** `feat(web): download your data and delete your account`.

### Task 7: E2E specs

**Files:**

- Create: `apps/web/e2e/account-export.spec.ts`, `apps/web/e2e/account-delete.spec.ts`
- Modify: `apps/web/playwright.config.ts`, `apps/web/e2e/support.ts` (export `EMAIL`), `apps/web/e2e/README.md`

- [ ] **Step 1: Write** `account-export.spec.ts` (chromium-desktop): sign in, open `/settings/account`, click **Meine Daten herunterladen** inside `page.waitForEvent('download')`; the suggested filename matches `/^wally-export-\d{4}-\d{2}-\d{2}\.json$/`; the parsed file has `profile.email === EMAIL` and a board named `Meine Wand` with at least one note.

- [ ] **Step 2: Write** `account-delete.spec.ts`: sign in, open `/settings/account`, click **Konto löschen**; the dialog lists `Meine Wand`; **Mein Konto löschen** is disabled; fill the field with `EMAIL`; click it; `waitForURL(/\/login/)`; `Dein Konto ist gelöscht.` is visible.

- [ ] **Step 3: Config:** add `/account-delete\.spec\.ts/` to `chromium-desktop`'s `testIgnore`, and a project `{ name: 'account-deletion', use: { ...devices['Desktop Chrome'] }, testMatch: /account-delete\.spec\.ts/, dependencies: ['chromium-desktop', 'mobile-list-only'] }`. README: why it runs last, and that CI's fresh database restores the account next run.

- [ ] **Step 4: Verify in CI** (E2E runs only there): push, and confirm the job lists `account-deletion` after the other projects and passes. Never count a local run as proof.

- [ ] **Step 5: Commit** `test(e2e): export download and account deletion`.

### Task 8: Docs

**Files:** `docs/GDPR.md`, `docs/AUTH0.md`, `docs/DEPLOY.md`, the privacy page copy (`apps/web/src/i18n/en.ts`, `de.ts`, `privacy` keys), the design's status line.

- [ ] **Step 1: GDPR.md:** GAP-01 and GAP-02 closed; the retention column for `users` rows says deleted on request; §6 decision 1 (erase) and decision 3 (self-service plus the runbook); the short-lived records table and pending invites as the stated exceptions.
- [ ] **Step 2: AUTH0.md:** the Management API application, its one scope `delete:users`, where its secret lives, the tombstone.
- [ ] **Step 3: DEPLOY.md:** owner setup (the M2M app, the secret `wally-auth0-management-client-secret` with `wally-api` access, the variable `AUTH0_MANAGEMENT_CLIENT_ID`); the read-only orphan check, one `count(*)` per new foreign key of rows whose user ID has no `users` row, expected 0; the deletion runbook (Auth0 dashboard, then the three statements of `eraseAccount` without the tombstone in the Supabase SQL editor, the user ID found by email); the production proof with a throwaway account.
- [ ] **Step 4: Privacy copy:** export and deletion are self-service.
- [ ] **Step 5: Run** `pnpm turbo run lint typecheck test` in the dev container; expect pass.
- [ ] **Step 6: Commit** `docs: account deletion and export are live in the app`.

### Finish

- [ ] One whole-branch review (`superpowers:requesting-code-review`), fixes, then push and open the PR. CI green before ready. The owner merges, runs the setup and the orphan check, approves the release, then runs the production proof.
