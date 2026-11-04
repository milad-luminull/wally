# Account deletion and data export — design

> **Status:** proposed, 2026-11-03. Waiting for the owner's approval.

Closes [GDPR.md](../../GDPR.md) GAP-01 (account deletion, Art. 17) and GAP-02 (data export,
Art. 15 and 20) on PostgreSQL, with Auth0 as the only identity provider
([ADR-0016](../../adr/ADR-0016-auth0-for-web-and-mcp.md)).

## Intent

Signup is open in production, and nobody can delete or export their own account. Requests to
privacy@luminull.com are handled by hand. The **Account and data** page has had both buttons
disabled since PR #76.

PR #76 removed the earlier version because it had grown into a cleanup system for seven
users: a Cloud Run job on a schedule, deleted-account checks inside about 40 transactions, a
recent-sign-in flow through the web app, the API and the Auth0 Action, swallowed errors, and
an export that made one transaction per note. **This design is deliberately small:** one
request deletes, one request exports, and nothing else in the app has to know that accounts
can be deleted.

## Goals

- A signed-in person deletes their own account and every trace of it, in one click after
  confirming, at once. The only exception is other people's short-lived records, which
  expire on their own schedule (below).
- A signed-in person downloads everything they can see in Wally as one JSON file.
- The owner can run the same deletion for someone who has lost their login.

## Non-goals

- A waiting period or undo. Deletion is immediate (owner, 2026-11-03).
- Anonymisation. Nothing of the person stays, not even as "Deleted user" (owner, 2026-11-03).
- Transferring board ownership.
- Retention jobs, invite expiry, share-link expiry (GAP-04, GAP-06, GAP-07). Separate work.
- A human-readable export (Markdown, ZIP).

## Anti-goals

- **Deleted-account checks spread across commands.** No "is this account deleted?" lookup
  in board commands, the assistant or MCP. Deletion removes the rows; everything else keeps
  working because the rows are gone.
- **A scheduler, queue or worker** for deletion.
- **Deleting the real CI test users in Auth0** from a CI run.
- **Silently skipping the Auth0 deletion in production.**

## What the owner decided (2026-11-03)

1. **Erase everything.** Notes the person created on other people's boards are deleted, with
   their subtasks and history. Cards they were only assigned to stay, unassigned. Their
   entries in the history of other notes are removed.
2. **Their own boards are deleted for everyone,** with everything on them, including notes
   other members wrote there. The confirmation lists those boards and their other members
   first.
3. **At once,** with no waiting period.
4. **The Auth0 user is deleted automatically,** through Auth0's Management API, by a
   machine-to-machine client allowed only `delete:users`, its secret in Secret Manager.
5. **Confirmation by typing the account's email.** No re-sign-in.
6. **Export contains everything they can see,** as one JSON file.
7. **Traces in other people's short-lived records expire on their own schedule** (owner,
   2026-11-04). They are not searched or scrubbed.

## Starting point (checked 2026-11-03, `main` 7b9660f7)

- **Schema** (`apps/api/src/lib/postgres/schema/`):
  - Rows that cascade when the `users` row is deleted: `auth_identities`, `mcp_connections`,
    `mcp_limits`, `assistant_usage`, `assistant_attempts`, `assistant_conversations`,
    `assistant_suggestions`, `assistant_tidies`, `board_operations`.
  - `whiteboards.owner_id` references `users` **without** cascade, so a user cannot be
    deleted while they own a board. Deleting a board cascades its members, share link,
    notes, subtasks and history.
  - **No foreign key:** `notes.created_by_id`, `notes.assignee_id`, `note_history.actor_id`,
    `board_members.user_id` and `invited_email`, `assistant_audit.actor_id`,
    `board_cleanup.user_id`. These are cleared explicitly.
  - `note_history.metadata` holds `via`, `duplicatedFrom` and move data, never a user ID.
  - `users.email` is not unique; identities, not emails, identify a person.
- **Board deletion** today (`commands/administration.ts`, `commands/maintenance.ts`): sets
  `deleted_at`, queues a `board_cleanup` job, and the job deletes the `whiteboards` row.
- **Sign-in** (`lib/auth/identities.ts`): `resolveOrCreateIdentity` creates an account for an
  unmapped token when `AUTH0_SIGNUP_ENABLED` is true, as in production. MCP never creates
  accounts.
- **Tokens:** Auth0 access tokens last 900 seconds; refresh tokens rotate
  ([AUTH0.md](../../AUTH0.md)).
- **Web:** `apps/web/src/routes/AccountPage.tsx` has the disabled buttons; logout returns to
  `/login`, which the SPA client already allows.
- **E2E:** CI signs in through real Auth0 as dedicated test users, bound to seeded Wally
  accounts ([E2E README](../../../apps/web/e2e/README.md)).

## Design

### Deleting an account

**API:** `DELETE /me`, body `{ "confirmEmail": "<the account's email>" }`. The server
compares it, case-insensitively, with `users.email` and answers 400 if it differs, so a
stray or forged call cannot delete an account.

**Preview:** `GET /me/deletion` returns what the dialog lists: each board the person owns,
with its name and number of other active members, and the number of notes they created on
other people's boards.

**Order.** The deletion runs in two steps, Auth0 first:

1. **Auth0, outside any transaction.** For each `auth_identities` row with Wally's Auth0
   issuer, the API deletes that Auth0 user. If Auth0 fails, nothing has been erased; the
   person sees an error and can try again.
2. **Then the database, in one transaction.** Every write in Wally goes through
   `withTransaction` (`lib/postgres/transaction.ts`), which runs SERIALIZABLE and re-runs the
   whole body on a conflict, up to five times, so its body "must not have effects outside the
   transaction". A deletion touches other people's boards, so a conflict is normal; keeping
   the Auth0 call out of the body means a re-run never calls Auth0 twice.

The remaining gap: Auth0 has deleted the user, then the database step fails after its
retries. The person can no longer sign in, and their Wally data is still there. That is
logged as an error with the Wally user ID, and the owner finishes it with the admin script,
told that the Auth0 step is already done. Nothing relies on how Auth0 answers a second delete
of the same user, which is undocumented.

**The database transaction** erases, in this order:

1. **Their boards:** every `whiteboards` row they own, deleted outright (not through the
   cleanup queue), with whatever cascades from it today. Pending `board_cleanup` rows for
   those boards go too.
2. **Their notes elsewhere:** every note with `created_by_id` = the user, on any board,
   including their private notes, deleted with its subtasks and history (cascade).
3. **Assignments:** remaining notes with `assignee_id` = the user get `assignee_id = null`
   and their revision bumped.
4. **History:** remaining `note_history` rows with `actor_id` = the user are deleted.
5. **Memberships and invites:** `board_members` rows with `user_id` = the user, and, **only
   if the account's email is verified**, pending invites whose `invited_email` is that
   email. An unverified address may belong to someone else, whose invites must survive.
6. **Audit and leftovers:** `assistant_audit` rows with `actor_id` = the user, and
   `board_cleanup` rows with `user_id` = the user.
7. **A short tombstone** (below), then the `users` row. Everything else cascades.

**What stays for a while: other people's short-lived records.** Some rows belong to another
member and can still mention the deleted person, by name or user ID inside their JSON:

| Record                                       | Whose                          | Gone after (checked in code 2026-11-04)                                                                   |
| -------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Command receipts (`board_operations`)        | the member who ran the command | 7 days (`commands/index.ts`)                                                                              |
| Assistant suggestions and tidies             | the member who asked           | 7 days (`SUGGESTION_RETENTION_DAYS`)                                                                      |
| Assistant conversations                      | the member who asked           | 30 days after the conversation's last turn, at most 20 turns (`CONVERSATION_RETENTION_DAYS`, `MAX_TURNS`) |
| `assistant_audit` rows another member caused | that member                    | 30 days (`ASSISTANT_AUDIT_RETENTION_DAYS`)                                                                |

The deletion leaves these alone and `purge_expired()` removes them when they expire.
Scrubbing them at once would mean searching JSON for the person and editing or deleting a
colleague's assistant history, which is what made the earlier version large. Audit rows the
person caused are deleted at once (step 6). Nothing in these records lets anyone act as the
deleted person, and the person's own rows of these kinds cascade with the `users` row.

**Why the tombstone.** Right after deletion the browser can still hold an access token for
up to 900 seconds. With signup open, any request carrying it would quietly create a new,
empty account. So the deletion writes `deleted_identities(issuer, subject, expires_at)` with
`expires_at` one hour ahead, and `resolveOrCreateIdentity` answers 401 while a row
matches. The existing `purge_expired()` cron job removes it. This is the only new check, at
the one place accounts are created.

**Auth0 Management API** (all checked 2026-11-03):

- Delete: `DELETE /api/v2/users/{id}`, scope `delete:users`; 204 on success; "This action
  cannot be undone"
  ([delete a user](https://auth0.com/docs/api/management/v2/users/delete-users-by-id)).
  A 404 is not documented. Treating "already gone" as success is _unverified_; the builder
  decides how to handle it.
- Token: client credentials at `https://login.luminull.com/oauth/token`. The **audience** is
  the tenant's **default** domain, `https://<tenant default domain>/api/v2/`; the endpoints use
  the custom domain ([custom domains](https://auth0.com/docs/customize/custom-domains/configure-features-to-use-custom-domains),
  [Management API tokens](https://auth0.com/docs/secure/tokens/access-tokens/management-api-access-tokens/get-management-api-access-tokens-for-production)).
  The token lasts 24 hours in Auth0's example. Keep it in memory until shortly before it
  expires.
- Free includes 1,000 machine-to-machine tokens a month ([pricing](https://auth0.com/pricing)).

**Configuration:** `AUTH0_MANAGEMENT_CLIENT_ID`, `AUTH0_MANAGEMENT_AUDIENCE` (variables) and
`AUTH0_MANAGEMENT_CLIENT_SECRET` (Secret Manager). With `NODE_ENV=production` all three are
required and the API refuses to start without them.

**Only production calls Auth0.** Local development, CI and production share one Auth0
tenant, and the issuer is fixed in code, so a local account's identity is a real Auth0 user,
often the developer's own login. Outside `NODE_ENV=production` the deletion therefore skips
the Auth0 step and logs that it did, **even when the credentials are set**. CI never deletes
its test users, and nobody deletes their own login from a local run.

**Web:**

- The **Delete account** button opens a dialog. It shows the preview: the boards that will be
  deleted for everyone, with their member counts, and the notes on other boards. The Delete
  button unlocks only when the typed text matches the account's email.
- On success the app clears its session, logs out of Auth0 and lands on `/login` with a
  "Your account is deleted" message. On failure it shows an error and stays.
- English and German copy.

**Admin path:** a command-line script for the owner, for someone who lost their login. It
runs the same function as `DELETE /me` for a given Wally user ID, without the email check.
It can list the Wally user IDs that match an email first, because emails are not unique. It
can be told the Auth0 step is already done, to finish a deletion whose database step failed.

### Exporting data

**API:** `GET /me/export` returns `application/json` with
`Content-Disposition: attachment; filename="wally-export-YYYY-MM-DD.json"`. It is built in
**one read-only transaction**, from the API's existing DTO mappers (`lib/dto.ts`), so it
matches what the app shows:

- `exportedAt` and a `formatVersion`;
- `profile` (as `/me` returns it);
- `boards`: every board they own or actively belong to, each with their role, its members (as
  the members list shows them), and every note visible to them, by the same visibility rules
  as the board view (their own private notes yes, other people's never), with subtasks and
  history;
- `connections`: their MCP connections (name, client, scopes, created, revoked);
- `assistant`: their daily usage, their conversations (the transcript entries), and their
  suggestions and tidies.

**Web:** the **Download my data** button fetches the file with the session's token and saves
it.

### Docs updated in the same PR

- [GDPR.md](../../GDPR.md): GAP-01 and GAP-02 closed; §6 decision 1 answered (erase, not
  anonymise) and decision 3 (on request, plus the admin script); the work-plan rows and
  checklist. It states that deletion is immediate except for mentions in other members'
  short-lived records, which expire as in the table above, and names those windows.
- The privacy page and the Account page copy (en, de): self-service export and deletion
  exist.
- [AUTH0.md](../../AUTH0.md): the Management API client, its single scope, and the tombstone.
- [DEPLOY.md](../../DEPLOY.md): the owner's setup steps below, and the release's new
  variables and secret.

## Owner setup, before the release

1. In Auth0, create a machine-to-machine application authorized for the Auth0 Management API
   with **only** `delete:users`.
2. Put its client secret in Secret Manager. Give `wally-api` read access to it, and the
   release identity if the release reads it.
3. Set the client ID and the tenant's default domain as production variables.

The builder writes the exact commands into DEPLOY.md. The owner runs them.

**Proof after the release.** CI and local never call Auth0, so the token exchange and the
delete first run in production. Right after the release the owner signs up in production with
a throwaway address, deletes that account in the app, and checks in the Auth0 dashboard that
the user is gone and in Wally that nothing of it is left. DEPLOY.md holds the steps.

## Testing

- **API integration tests** (per-file test database):
  - each erase step, including private notes, notes on other boards, unassignment,
    history removal, pending invites to the email, and audit rows;
  - a board the person owns with other members is gone for everyone;
  - other people's data is untouched;
  - an Auth0 failure leaves everything in place;
  - a database conflict re-runs the erase without calling Auth0 again;
  - outside production, Auth0 is never called, even with credentials set;
  - pending invites to an unverified email survive;
  - a wrong `confirmEmail` changes nothing;
  - the tombstone refuses a second sign-in with the old token and expires;
  - export visibility: other people's private notes never appear.
- **E2E (Playwright, CI):**
  - export downloads a JSON file containing the test user's board and note;
  - deletion: the confirm button stays disabled until the email is typed; after deleting,
    the app is signed out and shows the message.

  CI runs with `AUTH0_SIGNUP_ENABLED=false`, so the tombstone does not come into play there,
  and the Auth0 step is skipped (not production). The deletion spec deletes the seeded test
  account every other spec uses, so **it must run after every other spec in the run**, and
  the next run's seed must recreate that account.

## Calls made in this design (Claude's; the owner can overrule any)

1. **Auth0 first, then the database,** rather than a record-and-retry table, which would need
   a scheduler. The rare half-done case is finished with the admin script.
2. **A one-hour identity tombstone** blocks re-creation by a still-valid token.
3. **`DELETE /me` carries the typed email,** checked by the server too.
4. **Owned boards are deleted directly** in the deletion transaction, not queued.
5. **Only production calls Auth0,** and production refuses to start without its settings.
6. **Pending invites to the email are deleted only if that email is verified.**
7. **A production proof right after the release,** with a throwaway account.
8. **Export leaves out internal records:** the raw model messages (only the transcript
   entries), command receipts, audit records and cleanup jobs.
9. **No ADR.** Nothing here changes an accepted decision. The erase-vs-anonymise call is
   recorded in GDPR.md §6, where the question was asked.

## Left to the builder

- Endpoint and module layout, error codes beyond those named, the dialog's component
  structure.
- Whether to bump the revision of other boards whose notes changed.
- How a command already in flight when the deletion commits is handled. An accepted residual
  case is a write that resolved the user before the deletion and commits just after it. It
  must not require deleted-account checks in commands (anti-goals).
- The admin script's packaging and how the owner runs it.
- How the E2E deletion spec is ordered last.
