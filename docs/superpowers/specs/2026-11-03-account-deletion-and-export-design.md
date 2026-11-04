# Account deletion and data export — design

> **Status:** accepted 2026-11-04 and built (plan: [2026-11-04-account-deletion-and-export.md](../plans/2026-11-04-account-deletion-and-export.md)).

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
an export that made one transaction per note. **This design is deliberately small:** the
database's own foreign keys do the erasing, one request deletes, one request exports, and
nothing else in the app has to know that accounts can be deleted.

## Goals

- A signed-in person deletes their own account and every trace of it, in one click after
  confirming, at once. The only exception is other people's short-lived records, which
  expire on their own schedule (below).
- A signed-in person downloads everything they can see in Wally as one JSON file.
- The owner can delete the account of someone who has lost their login.

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
- **Erase logic in application code** that the schema can express. Each table says what
  happens to its rows when a user goes, so a new table cannot be forgotten.
- **A scheduler, queue, worker or admin tool** for deletion.
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

## Starting point (checked 2026-11-04, `main` a22ab4a0)

- **Schema** (`apps/api/src/lib/postgres/schema/`):
  - Rows that already cascade when the `users` row is deleted: `auth_identities`,
    `mcp_connections`, `mcp_limits`, `assistant_usage`, `assistant_attempts`,
    `assistant_conversations`, `assistant_suggestions`, `assistant_tidies`,
    `board_operations`.
  - `whiteboards.owner_id` references `users` **without** an action, so a user cannot be
    deleted while they own a board. Deleting a board cascades its members, share link,
    notes, subtasks and history.
  - **No foreign key:** `notes.created_by_id`, `notes.assignee_id`, `note_history.actor_id`,
    `board_members.user_id`, `assistant_audit.actor_id`. All nullable except
    `assistant_audit.actor_id`; all hold a user ID or null.
  - A private note must have `assignee_id = created_by_id`, both non-null (a check
    constraint in `notes.ts`).
  - `board_cleanup` has no foreign keys by design ("the job outlives what it cleans up"), and
    `drainCleanupJob` tolerates targets that are already gone (`commands/maintenance.ts`).
  - `note_history.metadata` holds `via`, `duplicatedFrom` and move data, never a user ID.
- **Sign-in** (`lib/auth/identities.ts`): `resolveOrCreateIdentity` creates an account for an
  unmapped token when `AUTH0_SIGNUP_ENABLED` is true, as in production. MCP never creates
  accounts. Since #98 each account has exactly one Auth0 identity, and the Post Login Action
  denies unverified signups ([ADR-0028](../../adr/ADR-0028-one-auth0-identity-per-account-with-passkeys.md),
  [AUTH0.md](../../AUTH0.md)).
- **Tokens:** Auth0 access tokens last 900 seconds. REST and MCP tokens have different fixed
  audiences (`lib/auth/constants.ts`).
- **No live sync:** the web app refetches on load and focus; nothing polls board revisions.
- **Web:** `apps/web/src/routes/AccountPage.tsx` has the disabled buttons. `GET /whiteboards`
  returns each board's name and `currentUserRole`; the members list exists per board. Logout
  returns to `/login`.
- **Config pattern:** fixed Auth0 values are constants (`constants.ts`); a setting required
  only in some modes is checked in `loadEnv` (`env.ts`, as `ASSISTANT_VERTEX_PROJECT`).
- **E2E:** CI signs in through real Auth0 as dedicated test users (`+1`, and `+2` for
  Dependabot), bound to seeded Wally accounts in a database that is new for every run
  ([E2E README](../../../apps/web/e2e/README.md)).

## Design

### The schema erases

One migration gives every user-ID column a foreign key to `users` that says what happens on
delete:

| Column                     | On delete  | Effect                                                   |
| -------------------------- | ---------- | -------------------------------------------------------- |
| `whiteboards.owner_id`     | `cascade`  | their boards go, with everything that cascades from them |
| `notes.created_by_id`      | `cascade`  | their notes on any board go, with subtasks and history   |
| `notes.assignee_id`        | `set null` | cards they were only assigned to stay, unassigned        |
| `note_history.actor_id`    | `cascade`  | their entries in other notes' history go                 |
| `board_members.user_id`    | `cascade`  | their memberships go                                     |
| `assistant_audit.actor_id` | `cascade`  | audit rows they caused go                                |

Foreign keys with referential actions are PostgreSQL's standard way to keep references
valid ([constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK)).
They also close the in-flight case: a write that resolved the user just before the deletion
and commits after it fails on the foreign key instead of leaving an orphan row.

Adding a foreign key checks every existing row. Before the release, the owner runs one
read-only query (in DEPLOY.md) that counts rows whose user ID has no `users` row. Production
started clean on 2026-10-31 and no account has been deleted since, so zero is expected. A
non-zero count is cleaned up first; otherwise the migration fails and the release stops,
with nothing changed.

### Deleting an account

**API:** `DELETE /me`, no request body. It takes the web app's REST token only (an MCP token
has a different audience and is refused). The typed email is a guard in the dialog, not an
API parameter: RFC 9110 §9.3.5 says content in a DELETE request "has no generally defined
semantics" and can make some implementations reject the request.

**Order.** Auth0 first, then the database:

1. **Auth0, outside any transaction.** The API deletes the account's one Auth0 user. If that
   fails (any answer but 204), nothing has been erased; the person sees an error and can try
   again.
2. **Then one `withTransaction`** (SERIALIZABLE, re-runs its body on a conflict, up to five
   times; the body "must not have effects outside the transaction"), so a re-run never calls
   Auth0 twice. It runs three statements:
   1. delete the notes they created (`created_by_id` = the user);
   2. insert the tombstone (below);
   3. delete the `users` row. The foreign keys do the rest.

   Their notes go first because a private note's check constraint requires an assignee, and
   PostgreSQL fires the two referential actions on that row in trigger-name order
   ([CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html)): if
   `set null` ran first, the delete would fail.

If the database step still fails after Auth0 succeeded, the person can no longer sign in and
their Wally data is still there. That is logged as an error with the Wally user ID, and the
owner finishes it by hand (below).

**Why the tombstone.** Right after deletion the browser can still hold an access token for
up to 900 seconds. With signup open, any request carrying it would quietly create a new
account holding the person's email and name. So the deletion writes
`deleted_identities(issuer, subject, expires_at)` with `expires_at` one hour ahead, and
`resolveOrCreateIdentity` answers 401 while a row matches, checked only on the path that
creates accounts. `purge_expired()` gets the table added to its list. This is the only new
check.

**What stays for a while: other people's short-lived records.** Some rows belong to another
member and can still mention the deleted person, by name or user ID inside their JSON:

| Record                                       | Whose                          | Gone after (checked in code 2026-11-04)                                                                   |
| -------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Command receipts (`board_operations`)        | the member who ran the command | 7 days (`commands/index.ts`)                                                                              |
| Assistant suggestions and tidies             | the member who asked           | 7 days (`SUGGESTION_RETENTION_DAYS`)                                                                      |
| Assistant conversations                      | the member who asked           | 30 days after the conversation's last turn, at most 20 turns (`CONVERSATION_RETENTION_DAYS`, `MAX_TURNS`) |
| `assistant_audit` rows another member caused | that member                    | 30 days (`ASSISTANT_AUDIT_RETENTION_DAYS`)                                                                |

The deletion leaves these alone and `purge_expired()` removes them when they expire. Nothing
in them lets anyone act as the deleted person, and the person's own rows of these kinds go
with the `users` row.

**Left alone on purpose:**

- **Pending invites to their email address.** They are the inviter's record of an address,
  like the rows above, and would be found by anyone who later signs up with that address, as
  any invite is. Invite expiry is GAP-06.
- **`board_cleanup` jobs.** Each finishes on its own: `drainCleanupJob` already tolerates a
  target that is gone.
- **Revisions.** Notes that lose their assignee keep their revision. Nothing polls
  revisions, other members see the change on their next load, and the response to their
  next edit of that note carries it.

**Auth0 Management API** (all checked 2026-11-03):

- Delete: `DELETE /api/v2/users/{id}`, scope `delete:users`; 204 on success; "This action
  cannot be undone"
  ([delete a user](https://auth0.com/docs/api/management/v2/users/delete-users-by-id)).
- Token: client credentials at `https://login.luminull.com/oauth/token`, with the tenant's
  **default** domain as the audience, `https://<tenant default domain>/api/v2/`
  ([custom domains](https://auth0.com/docs/customize/custom-domains/configure-features-to-use-custom-domains),
  [Management API tokens](https://auth0.com/docs/secure/tokens/access-tokens/management-api-access-tokens/get-management-api-access-tokens-for-production)).
  A new token for each deletion, no cache: Free includes 1,000 machine-to-machine tokens a
  month ([pricing](https://auth0.com/pricing)).

**Configuration:** the audience is a constant next to `AUTH0_ISSUER`, as the other fixed
Auth0 values are. Two settings: `AUTH0_MANAGEMENT_CLIENT_ID` (variable) and
`AUTH0_MANAGEMENT_CLIENT_SECRET` (Secret Manager). The Auth0 step runs when both are set;
`loadEnv` requires them with `NODE_ENV=production`, so production never skips it. Local
development and CI do not have the secret, so they skip the step and log that they did; CI
never deletes its test users. Tests pass a fake deleter, as they pass a fake model runner.

**Web:**

- The **Delete account** button opens a dialog. It lists the boards that will be deleted for
  everyone and their other members, from the existing boards list (`currentUserRole` =
  owner) and each owned board's members list. The Delete button unlocks only when the typed
  text matches the account's email.
- On success the app clears its session and logs out of Auth0 to `/login`, which says "Your
  account is deleted" (a flag in `sessionStorage`, so no Auth0 setting changes). On failure
  it shows an error and stays.
- English and German copy.

**The owner's path, for someone who lost their login:** a runbook in DEPLOY.md, no script.
Delete the Auth0 user in the Auth0 dashboard, then run the same three statements in the
Supabase SQL editor for the Wally user ID, found by email first because emails are not
unique. The tombstone is not needed there. The same runbook finishes a deletion whose
database step failed.

### Exporting data

**API:** `GET /me/export` returns `application/json` with
`Content-Disposition: attachment; filename="wally-export-YYYY-MM-DD.json"`. It is built from
the API's existing read queries (`listBoards`, `listMembers`, `listNotes`), each its own
snapshot, plus one query for the subtasks and one for the history of each board's listed
notes, and the existing DTO mappers (`lib/dto.ts`), so it matches what the app shows:

- `exportedAt` and a `formatVersion`;
- `profile` (as `/me` returns it);
- `boards`: every board they own or actively belong to, each with their role, its members (as
  the members list shows them), and every note visible to them, by the same visibility rules
  as the board view (their own private notes yes, other people's never), with subtasks and
  history;
- `connections`: their MCP connections (name, client, scopes, created, revoked);
- `assistant`: their daily usage, their conversations (the transcript entries), and their
  suggestions and tidies.

Left out: the raw model messages (the transcript entries cover them), command receipts,
audit records and cleanup jobs.

**Web:** the **Download my data** button fetches the file with the session's token and saves
it.

### Docs updated in the same PR

- [GDPR.md](../../GDPR.md): GAP-01 and GAP-02 closed; §6 decision 1 answered (erase, not
  anonymise) and decision 3 (self-service, plus the owner's runbook); the work-plan rows and
  checklist. It states that deletion is immediate except for mentions in other members'
  short-lived records and pending invites to the address, and names the windows above.
- The privacy page and the Account page copy (en, de): self-service export and deletion
  exist.
- [AUTH0.md](../../AUTH0.md): the Management API client, its single scope, and the tombstone.
- [DEPLOY.md](../../DEPLOY.md): the owner's setup and the orphan check below, the owner's
  deletion runbook, and the release's new variable and secret.

## Owner setup, before the release

1. In Auth0, create a machine-to-machine application authorized for the Auth0 Management API
   with **only** `delete:users`.
2. Put its client secret in Secret Manager. Give `wally-api` read access to it, and the
   release identity if the release reads it.
3. Set the client ID as a production variable.
4. Run the orphan check; it should report zero.

The builder writes the exact commands into DEPLOY.md. The owner runs them.

**Proof after the release.** CI and local never call Auth0, so the token exchange and the
delete first run in production. Right after the release the owner signs up in production with
a throwaway address, deletes that account in the app, and checks in the Auth0 dashboard that
the user is gone and in Wally that nothing of it is left. DEPLOY.md holds the steps.

## Testing

- **API integration tests** (per-file test database):
  - the foreign keys: deleting a user removes their boards (for everyone), their notes on
    other boards including private ones, their history entries, memberships and audit rows,
    and unassigns the rest; other people's data is untouched;
  - a pending invite to their email survives;
  - an Auth0 failure leaves everything in place;
  - without the settings, Auth0 is never called;
  - an MCP token cannot call `DELETE /me` (already covered: the REST verifier accepts only
    the REST audience, `mcp.test.ts`);
  - the tombstone refuses a new account for the old token and expires;
  - export visibility: other people's private notes never appear.
- **Web unit test:** the Delete button stays disabled until the typed email matches.
- **E2E (Playwright, CI):**
  - export downloads a JSON file containing the test user's board and note;
  - deletion: type the email, delete, land signed out on `/login` with the message.

  The deletion spec deletes the test user's Wally account, so it sits in its own Playwright
  project that lists the main project in `dependencies` and runs only after it passes
  ([projects](https://playwright.dev/docs/test-projects)). CI's database is new for every
  run, so the next run's seed recreates the account as it does today. CI has no Auth0
  secret, so the test user stays in Auth0.

## Calls made in this design (Claude's; the owner can overrule any)

1. **Foreign keys erase,** not application code: one migration, and the deletion is three
   statements.
2. **Auth0 first, then the database,** rather than a record-and-retry table, which would need
   a scheduler. The rare half-done case is finished with the runbook.
3. **A one-hour identity tombstone** blocks re-creation by a still-valid token.
4. **`DELETE /me` has no body;** the typed email is checked in the dialog.
5. **No preview endpoint;** the dialog uses the boards and members lists.
6. **The Auth0 step runs when configured,** and production refuses to start without it.
7. **Pending invites, cleanup jobs and revisions are left alone.**
8. **No admin script;** the owner's path is a runbook.
9. **A production proof right after the release,** with a throwaway account.
10. **No ADR.** Nothing here changes an accepted decision. The erase-vs-anonymise call is
    recorded in GDPR.md §6, where the question was asked.

## Left to the builder

- Endpoint and module layout, error codes beyond those named, the dialog's component
  structure.
- How a schema test that inserts rows without a `users` row gets one.
