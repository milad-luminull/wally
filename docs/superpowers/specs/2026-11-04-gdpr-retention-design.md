# Retention: share-link expiry, invite expiry and a written retention policy (GDPR GAP-04, GAP-06, GAP-07) — design

> **Status:** approved by the owner, 2026-11-04. Plan: [2026-11-04-gdpr-retention.md](../plans/2026-11-04-gdpr-retention.md).

Date: 2026-11-04. Closes [GDPR.md](../../GDPR.md) GAP-04 (no retention policy), GAP-06 (share
links never expire and are not auditable) and GAP-07 (emails of people who never signed up
are kept indefinitely). It follows the account deletion and export work (GAP-01, GAP-02;
[design](2026-11-03-account-deletion-and-export-design.md), branch
`docs/account-deletion-export`), which lists these three gaps as separate work.

## Intent

GDPR's storage-limitation principle (Art. 5(1)(e)) asks that personal data be kept no longer
than its purpose needs. Today Wally has no written retention rule, and three kinds of data
outlive their purpose:

- **Share links** work forever. A link handed out once grants access until the owner
  remembers to revoke it, and nobody can tell whether it is still being used.
- **Pending invites** keep the email address of someone who never signed up, forever. That
  person has no account and no way to ask for their data to be removed.
- **Assistant usage counters** (`assistant_usage`, one row per user per UTC day) accumulate
  forever.

The owner decided the periods (2026-11-04). This work enforces them in code, writes the
policy down in one place, and tells users in the privacy notice.

## Owner decisions (2026-11-04)

| Data                                                             | Retention                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Notes, including completed notes                                 | **Never deleted automatically.** The user deletes them, or they go with their board or account.            |
| Note history (`note_history`)                                    | **Lives exactly as long as its note.** No separate limit.                                                  |
| Pending invites (`board_members` `PENDING`)                      | **30 days** after the invite, then the row and its email address are deleted.                              |
| Share links                                                      | **The owner picks 7 days, 30 days or never** when creating the link. **30 days is pre-selected.**          |
| Share links that exist when this ships                           | **Expire 30 days after the release.**                                                                      |
| People who joined through a share link                           | **Lose access when the link expires, is regenerated or is turned off.**                                    |
| Data held by vendors (Auth0, Google Cloud, Cloudflare, Supabase) | **In the retention table too**, with each period checked against the vendor's documentation and cited.     |
| Inactive accounts                                                | **Not deleted automatically.** Accounts stay until the person deletes them (the account deletion feature). |
| Assistant daily usage counters                                   | **12 months.**                                                                                             |

The reason notes and history have no time limit, for GDPR.md: they are the user's own working
material, the user controls them (edit, complete, delete, delete the board, delete the
account), and deleting work someone still relies on would defeat the purpose they are kept
for. The period is "as long as the user keeps it", which Art. 5(1)(e) allows when the purpose
is the user's ongoing use. This is the owner's decision; GDPR.md records it as such.

## Goals

1. A share link stops working when its expiry passes, and is deleted soon after. Everyone who
   joined through it loses access at the same moment, and when the owner regenerates or turns
   off the link.
2. The owner chooses a link's expiry, sees when it expires, sees when it was last used, and
   sees which members joined through it.
3. A pending invite stops being claimable 30 days after it was made, and the row and its
   email address are deleted soon after.
4. Assistant usage rows older than 12 months are deleted.
5. One table in GDPR.md lists every kind of personal data and how long it is kept, in
   Wally's database and at each vendor, and the privacy notice tells users the same in plain
   words.

## Non-goals

- Automatic deletion of notes, completed notes, history or inactive accounts (owner,
  2026-11-04).
- GAP-08's other half (whether history should record the actor at all). History now simply
  follows its note; the activity-data question stays open in GDPR.md §8.
- An invitation email. Wally sends no email today (Resend arrives with RFC-0011 workstream 5).
  GAP-07's "say the purpose and retention in the invitation email" waits for that; GDPR.md
  keeps that part open.
- A warning before a link or invite expires.
- A separate "this link has expired" message. Once the hourly purge has deleted the row, an
  expired link cannot be told apart from a deleted one, so both show the existing "link not
  found" state.

## Anti-goals

- An expired link or invite that still works in the window before the hourly purge runs, or
  a member who joined through an expired link who can still open the board in that window.
  Expiry is checked at the moment of use and in every access check; the purge only cleans
  up.
- A vendor retention period in GDPR.md or the privacy notice that is not backed by the
  vendor's own documentation (project rule: verified practice only). Anything that cannot be
  checked is listed as unverified, not guessed.
- A share-link token in any log or audit record (GDPR.md GAP-06: "Do not log the token value
  itself").
- Touching the account deletion branch's files before it merges (see Constraints).

## Constraints

- **Build after the account deletion PR merges.** Both change
  `apps/api/src/lib/postgres/schema/boards.ts`, the `purge_expired()` migration chain, the
  privacy text in `apps/web/src/i18n/{en,de}.ts` and GDPR.md. The deletion plan adds
  migrations `0002_*` and `0003_purge_deleted_identities.sql` and puts a new table into
  `purge_expired()`. This work's migration takes the next free number and redefines
  `purge_expired()` from whatever the deletion work left, so nothing it added is lost.
- English identifiers and stored values; German only in the catalogues
  (ADR-0014, project rule).
- A plan with E2E specs and green CI before the PR is ready (project rule). No stacked PRs.
- Supabase Free: no new services. The hourly `wally-purge-expired` Supabase Cron job
  (`apps/api/drizzle/0001_purge_expired.sql`) does the cleanup; no new job.

## Design

### Share links

**Schema** (`share_links`), three new columns:

| Column             | Type                  | Meaning                                                                                |
| ------------------ | --------------------- | -------------------------------------------------------------------------------------- |
| `expiry`           | text, not null        | The owner's choice: `DAYS_7`, `DAYS_30` or `NEVER` (a check constraint, as `role` has) |
| `expires_at`       | timestamptz, nullable | When it stops working; null for `NEVER`                                                |
| `last_redeemed_at` | timestamptz, nullable | The last successful redemption by someone other than the board owner                   |

`expiry` is stored so that rotating a link can give the new token the same duration.

**Migration of existing rows:** `expiry = 'DAYS_30'`, `expires_at` = the migration's run time
plus 30 days (owner decision: existing links expire 30 days after the release; the migration
runs in the release, so its run time is the release time). `last_redeemed_at` stays null.

**Contract** (`packages/shared`):

- `shareLinkExpiryValues = ['DAYS_7', 'DAYS_30', 'NEVER']` in the shared enums.
- `link.create` input: `{ role, expiry }`, `expiry` defaulting to `DAYS_30` when absent so old
  clients keep working.
- `link.update` input: `{ role?, expiry? }`, at least one. Changing `expiry` restarts the clock
  from now (7 or 30 days from the change) or clears it (`NEVER`). Changing only `role` leaves
  `expires_at` alone.
- `link.rotate`: new token, same `expiry`, `expires_at` restarted from now, `last_redeemed_at`
  cleared (it is a new link).
- `ShareLinkDto` gains `expiry`, `expiresAt` (ISO string or null) and `lastRedeemedAt` (ISO
  string or null).

**Enforcement:**

- `link.redeem`: a link whose `expires_at <= now` is treated exactly like a missing link (the
  existing 404). The owner opening their own expired link gets the same 404; the owner's
  "is this my board" shortcut runs after the expiry check.
- On a successful redemption by a non-owner, set `last_redeemed_at = now`. The token is never
  logged.
- `getShareLink` (the owner's view): an expired row not yet purged is returned as no link
  (404), so the share sheet shows "no link" the moment it expires, not up to an hour later.
- `link.create` when an expired, not-yet-purged row exists: replace it as if it were absent,
  rather than the 409 `SHARE_LINK_EXISTS`.
- `link.update` and `link.rotate` on an expired, not-yet-purged row: 404, as if there were no
  link. Otherwise setting its expiry to "never" would give its old members their access back.

**Purge:** `purge_expired()` deletes `share_links` rows with `expires_at <= at`. Rows with a
null `expires_at` are never touched.

**Web** (`apps/web/src/features/board/Share/ShareLinkControls.tsx`):

- Creating a link: an expiry select next to the role select, with "7 days", "30 days"
  (pre-selected) and "Never".
- An existing link: the same select, showing its current choice; changing it sends
  `link.update` with the new `expiry`.
- Under the link: "Expires on {date}" or "Never expires", and "Last used {date}" or "Not used
  yet". Dates in the user's locale, date only.
- New strings in `en.ts` and `de.ts`.

### Members who joined through a link

Today `link.redeem` writes a permanent `ACTIVE` row in `board_members` that cannot be told
apart from an invited member's, and `link.delete` leaves those rows in place. The owner
decided (2026-11-04) that link access ends with the link.

**Schema:** `board_members` gains `joined_by_link` (boolean, not null, default false). A board
has at most one share link, so "the link" a member joined through is always the board's
current link. Existing rows are migrated as `false`: there is no record of how they joined,
so they stay (Claude's call; the alternative, removing every existing member, cannot tell
link joins from invites).

**Setting and clearing the flag:**

- `link.redeem` creating a new row: `joined_by_link = true`.
- `link.redeem` by someone who already has an `ACTIVE` row, or who claims a pending invite to
  their verified email: the flag stays as it was, or `false` for a claimed invite. An invite
  makes membership permanent.
- `member.invite` matching an existing link member: sets `joined_by_link = false`. The owner
  inviting someone by email makes them a permanent member (Claude's call).
- `member.update` (role change) leaves the flag alone (Claude's call).

**Losing access:**

- **Access checks:** wherever the API resolves a user's role on a board (`requireAccess`, the
  board list, MCP), a row with `joined_by_link = true` counts only while the board has a
  share link whose `expires_at` is null or in the future. Otherwise it is treated as absent.
  This makes access end at the moment of expiry, regenerate or turn-off, before any cleanup
  runs.
- **Clean-up:** one database function, `remove_link_members(board, at)`, deletes the board's
  `joined_by_link` rows and, in the same statement, releases the removed people's
  assignments on shared notes, with the same rule as the `member.remove` cleanup job (a
  person who still holds another `ACTIVE` row keeps theirs; private notes stay assigned and
  hidden, GDPR.md §3). Callers bump the board revision.
  - `link.rotate`, `link.delete` and `link.create` over an expired row call it in their own
    transaction. No cleanup jobs: the cleanup jobs that exist today are drained only right
    after the command that queued them, or by hand with `pnpm maintenance --cleanup`, so a
    job queued from the hourly purge would never run.
  - Expiry: the hourly `purge_expired()` calls it for each board whose link has expired,
    before deleting the link.
- `link.update` changing only the role leaves link members' roles alone (Claude's call).
  Changing the expiry so that it lies in the past is not possible (the choices are 7 days, 30
  days or never, counted from now).

**Web:**

- The member list shows "Joined by link" under a link member's name (Claude's call), so the
  owner can see who will lose access.
- Under the link controls, one line: "People who joined through this link lose access when
  it expires, is regenerated or turned off."
- The confirmations for "Regenerate" and "Turn off" (or, where none exists today, the hint
  next to the buttons) say the same.

### Pending invites

No schema change. A pending invite's expiry is `invited_at + 30 days`.

- **Claiming** (`link.redeem` and the sign-in path that turns a `PENDING` row for a verified
  email into `ACTIVE`): a `PENDING` row older than 30 days is ignored, as if absent. The
  builder finds every place that claims a `PENDING` row by `invited_email` (at least
  `link.redeem` in `administration.ts` and first-request provisioning) and applies the same
  rule through one shared helper.
- **Re-inviting** the same address while the invite is still pending restarts the 30 days
  (`invited_at = now`). Today `member.invite` keeps the old row unchanged except for the
  role; this changes it to also refresh `invited_at`. (Claude's call: the owner asking again
  is a fresh purpose.)
- **Member list:** a pending invite shows "Invite expires on {date}" instead of the plain
  "Pending" label. Expired rows not yet purged are left out of the list.
- **Purge:** `purge_expired()` deletes `board_members` rows with `status = 'PENDING'` and
  `invited_at <= at - interval '30 days'`.

### Assistant usage counters

**Purge:** `purge_expired()` deletes `assistant_usage` rows with
`day < (at - interval '12 months')::date`. `assistant_spend` (one row per month for the whole
deployment, no user id) holds no personal data and is left alone.

### `purge_expired()`

Today it loops over tables with an `expires_at` column. The new deletes do not fit that shape
(invites use `invited_at`, usage uses `day`), so the function gets explicit statements after
the loop, each returning its own `(table_name, deleted)` row. For the invite delete,
`table_name` is `board_members`. The 30-day and 12-month periods are constants in the API
(`apps/api/src/lib/retention.ts`), and the migration uses the same numbers. The purge's
boundary tests build their timestamps from those constants, so a mismatch fails them.

`pnpm maintenance` (`apps/api/src/lib/db/purge.ts`) calls the same function and needs no
change beyond expecting the new rows.

### Vendor retention (research task, a second PR)

The retention table covers data outside Wally's database too (owner, 2026-11-04). This is a
separate docs-only PR after the code PR merges, so console checks and open vendor questions
never hold up the feature. The code PR's GDPR.md table covers Wally's database and says the
vendor part follows. For each item, it finds the vendor's documented retention,
cites the page and the date it was checked, and checks Wally's actual setting where one
exists:

- Auth0: tenant logs (retention depends on the plan) and user profiles (kept until Wally's
  account deletion removes them).
- Google Cloud: Cloud Run request logs in the `_Default` log bucket (GAP-05), Secret Manager
  holds no personal data (check).
- Cloudflare: Workers logs and analytics, as configured for `wally-web` and
  `wally-api-proxy` (telemetry is off in `wrangler.jsonc`; check what remains).
- Supabase (Free plan): database logs and API logs; backups (the owner chose no backups on
  2026-10-31; check what the Free plan keeps regardless).
- Vertex AI: what Google keeps from assistant requests.
- The `deleted_identities` rows from the account deletion work.

A period that cannot be verified is written as "unverified" with what was checked. A
period Wally can configure but has not decided (for example a log bucket's retention) goes to
the owner as a question in the PR, not into the table as a decision.

### GDPR.md and the privacy notice

- **GDPR.md:**
  - §2: a new "Retention" table that lists every kind of personal data with its period and
    what deletes it, including the owner's reason for notes and history, and a vendor part
    built from the research task.
  - GAP-04: resolved, pointing at the table.
  - GAP-06: resolved.
  - GAP-07: resolved for retention; the invitation-email notice stays open until Wally sends
    email.
  - GAP-08: note the retention half settled (history follows its note); the activity-data
    question stays open.
  - The `share_links` and `board_members` inventory rows gain the new columns and periods.
- **Privacy notice** (`privacy.*` in `en.ts` and `de.ts`): the retention paragraph says, in
  plain words, that boards and notes stay until the user deletes them; invites to people
  without an account are deleted after 30 days; share links expire after the period the
  board owner picks, and people who joined through a link lose access when it expires;
  assistant usage counts are kept for 12 months; and, once the research PR lands, the vendor periods that were verified.
  It replaces today's "provider backups may follow separate retention schedules; contact us
  for details" with those periods.
- **RFC/ADR indexes:** no RFC or ADR changes status. Production version lines are updated by
  the release, not by this PR.

## Tests

- **API unit and integration:** redeem refuses an expired link and an expired invite (one
  second past); redeem sets `last_redeemed_at` for a non-owner and not for the owner;
  `link.update` with only `role` keeps `expires_at`; with `expiry` restarts it; rotate keeps
  `expiry`, restarts `expires_at`, clears `last_redeemed_at`; `link.create` over an expired
  row succeeds; `getShareLink` hides an expired row; re-invite restarts `invited_at`; the
  migration gives existing links `DAYS_30` and run time plus 30 days; `purge_expired()`
  deletes exactly the expired links, the old pending invites (not old `ACTIVE` rows) and
  usage rows older than 12 months, and leaves the rest.
- **Link members:** redeem sets `joined_by_link`; claiming an invite or being invited by
  email clears it; a link member loses access one second past expiry before any purge;
  rotate and delete remove link members and release their assignments; the purge removes
  them with an expired link and their assignments are released; members with
  `joined_by_link = false` are never touched.
- **Web unit:** the expiry select, its default, and the expiry and last-used lines; the
  member list's expiry line and "Joined by link" label.
- **E2E** (`apps/web/e2e/share.spec.ts`): create a link with "7 days", see "Expires on" with
  the right date; change it to "Never", see "Never expires". The existing assertion on the
  "Pending" label (`Ausstehend`) changes to the new expiry line. No second-user step: CI has
  one Auth0 test account, so "Last used" and link-member removal are covered by API and web
  unit tests (owner, 2026-11-04). Expiry itself is covered by the API tests (a real E2E
  cannot wait seven days).

## Left to the builder

- Exact names of constants, helpers and i18n keys.
- How the select and date lines are laid out within the existing share sheet style.
- Whether the invite-age rule lives in SQL (`invited_at > now() - interval`) or in
  TypeScript, as long as one helper defines it.
- How the plan splits into tasks.
- Known details from the builder check: `purgeExpired`'s `TABLES` map in
  `apps/api/src/lib/db/purge.ts` needs the new keys; the member upsert's
  `onConflictDoUpdate` must also set `invitedAt` (re-invite) and `joinedByLink`; `MemberDto`
  gains `inviteExpiresAt` (computed by the API for pending rows, so the 30-day rule lives only
  on the server) and `joinedByLink`; the create flow has no role select today, only a
  button that creates a VIEW link, so where the expiry select goes is a layout choice; seed
  links and invites need the new values.

## Claude's calls (the owner can overrule any)

1. `expiry` is stored as well as `expires_at`, so rotation keeps the duration.
2. Changing a link's expiry restarts the clock from the change; changing only its role does
   not.
3. Rotation restarts the clock and clears "last used".
4. An expired link shows the same "not found" state as a deleted one.
5. Re-inviting a pending address restarts its 30 days.
6. The owner's own use of a link does not count as "last used".
7. No warning before expiry, and no invitation email until Wally sends email.
8. Members who exist before the release are migrated as invited (`joined_by_link = false`),
   so nobody loses access at the release.
9. Inviting a link member by email makes them permanent; a role change does not.
10. The member list labels link members "Joined by link".
