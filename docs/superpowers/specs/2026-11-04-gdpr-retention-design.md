# Retention: share-link expiry, invite expiry and a written retention policy (GDPR GAP-04, GAP-06, GAP-07) — design

> **Status:** approved by the owner, 2026-11-04; cut down for maintenance on 2026-11-04 (see
> "What this design leaves out on purpose"). Plan:
> [2026-11-04-gdpr-retention.md](../plans/2026-11-04-gdpr-retention.md).

Date: 2026-11-04. Closes [GDPR.md](../../GDPR.md) GAP-04 (no retention policy), GAP-06 (share
links never expire) and GAP-07 (emails of people who never signed up are kept
indefinitely). It follows the account deletion and export work (GAP-01, GAP-02;
[design](2026-11-03-account-deletion-and-export-design.md), branch
`docs/account-deletion-export`), which lists these three gaps as separate work.

## Intent

GDPR's storage-limitation principle (Art. 5(1)(e)) asks that personal data be kept no longer
than its purpose needs, and Art. 13 asks that users are told how long. Today Wally has no
written retention rule, and three things outlive their purpose:

- **Share links** work forever.
- **Pending invites** keep the email address of someone who never signed up, forever.
- **Assistant usage counters** (`assistant_usage`, one row per user per UTC day) accumulate
  forever.

The guiding rule for this work is **the least code that meets the owner's decisions**. Every
rule is enforced by the hourly cleanup job that already exists, plus one check where access
is granted. Nothing new runs anywhere else.

## Owner decisions (2026-11-04)

| Data                                    | Retention                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Notes, including completed notes        | **Never deleted automatically.** The user deletes them, or they go with their board or account.            |
| Note history (`note_history`)           | **As long as its note.** No separate limit.                                                                |
| Inactive accounts                       | **Not deleted automatically.** Accounts stay until the person deletes them (the account deletion feature). |
| Pending invites (and the email in them) | **30 days** after the invite.                                                                              |
| Share links                             | **The owner picks 7 days, 30 days (pre-selected) or never** when creating the link.                        |
| Share links that exist when this ships  | **Expire 30 days after the release.**                                                                      |
| People who joined through a share link  | **Lose access when the link expires, is regenerated or is turned off.**                                    |
| Assistant daily usage counters          | **30 days** (owner, 2026-11-04: enough for the daily limit; cost is tracked without users).                |
| Data held by vendors                    | **In the retention table too**, in a second, docs-only PR.                                                 |

Why notes and history have no time limit, for GDPR.md: they are the user's own working
material, the user controls them (edit, complete, delete, delete the board, delete the
account), and deleting work someone still relies on would defeat the purpose they are kept
for. Art. 5(1)(e) allows "as long as the user keeps it" when the purpose is the user's ongoing
use. This is the owner's decision; GDPR.md records it as such.

## How expiry works: at most an hour late, except where access is granted

The hourly `wally-purge-expired` job (`purge_expired()`, pg_cron) does all deleting. Only
**opening a share link** checks expiry at the moment of use, because that is where access is
granted. Everything else may lag by up to an hour (owner, 2026-11-04):

- A member who joined through an expired link keeps access until the next hourly run.
- An invite at day 30 can still be claimed until the next hourly run.
- The owner's share sheet shows an expired link until the next hourly run; opening it fails.
- If the owner changes an expired, not-yet-deleted link back to "never" within that hour,
  the link and its members stay. That is the owner turning it back on, not a leak.

An hour is well inside what storage limitation asks, and it removes every expiry check from
access control, member lists and invite claiming.

## Design

### Schema

- `share_links.expires_at` (timestamptz, nullable; null = never). Existing rows: the
  migration's run time plus 30 days (the migration runs in the release).
- `board_members.joined_by_link` (boolean, not null, default false). Existing rows: false,
  so nobody loses access at the release.

### API

- `link.create` takes `expiresIn`: `DAYS_7`, `DAYS_30` (default, so old clients keep working)
  or `NEVER`, and stores the resulting `expires_at`. The duration itself is not stored.
- `link.update` takes `role` and/or `expiresIn`; `expiresIn` sets `expires_at` counted from
  now.
- `link.redeem`: a link with `expires_at <= now()` is treated as missing (the existing 404),
  checked before the owner shortcut. A new member row gets `joined_by_link = true`; claiming
  a pending invite sets it false; an existing row keeps its value.
- `member.invite` matching a link member sets `joined_by_link = false`: an email invite makes
  membership permanent.
- `link.rotate` and `link.delete` remove the board's link members in the same transaction
  (`remove_link_members`, below). `link.rotate` keeps `expires_at`.
- `getShareLink` and `ShareLinkDto` gain `expiresAt`.

### The two database functions

The hourly job runs inside the database, so removing link members must be possible there.
To keep one implementation, it is SQL, used by both the API and the job (this is the only
reason logic lives in the database; ADR-0020 otherwise holds):

- `release_assignments(board, member, at)`: today's `member.remove` rule (unassign the
  person's shared notes on that board unless they are the owner or still a member; private
  notes stay assigned and hidden, GDPR.md §3). `drainCleanupJob` calls it instead of its own
  update, so the rule exists once.
- `remove_link_members(board, at)`: deletes the board's `joined_by_link` rows and calls
  `release_assignments` for each removed person.

### The hourly job

`purge_expired()` keeps what it does today (and whatever the deletion work added) and also:

1. for each board whose link has `expires_at <= at`: `remove_link_members`, bump the board
   revision, delete the link;
2. deletes `PENDING` `board_members` rows with `invited_at <= at - 30 days`;
3. deletes `assistant_usage` rows with `day` older than 30 days.

The periods are written in the migration only; the tests use the same numbers.

### Web

- Creating a link: a select with 7 days, 30 days (pre-selected) and never.
- An existing link: "Expires on {{date}}" or "Never expires", and a "Change expiry" select
  with the same three options, counted from today.
- One line under the link: "People who joined through this link lose access when it
  expires, is regenerated or turned off."
- The member list shows "Joined by link" under a member who joined through the link
  (owner, 2026-11-04), so the owner sees who will lose access. `MemberDto` gains
  `joinedByLink`.
- Pending invites keep today's "Pending" label.

### Docs

- **GDPR.md:** §2 gains a retention table for Wally's database with each period and what
  deletes it, the reason for notes and history, and the purpose of the 30-day usage
  counters (the daily limit). GAP-04, GAP-06 resolved; GAP-07 resolved for retention (the invitation-email
  notice stays open until Wally sends email); GAP-08's retention half settled. The
  `share_links` and `board_members` inventory rows gain the new columns.
- **Privacy notice** (`privacy.*` in `en.ts` and `de.ts`): the retention paragraph states the
  periods in plain words.
- **Vendors (second PR):** one row per vendor naming what it holds, a link to the vendor's
  own retention documentation, and Wally's setting only where Wally configures one. No
  vendor periods are copied into Wally's docs, so nothing goes stale when a vendor changes
  its plans. Anything unchecked is marked unverified (project rule: verified practice only).

## Tests

- **API:** redeem refuses a link one second past expiry and accepts one a second before, the
  owner included; create defaults to 30 days and stores null for never; a role-only update
  keeps `expires_at`; rotate and delete remove link members and unassign their shared notes
  only; claiming an invite or an email invite clears `joined_by_link`; the existing member
  removal tests pass unchanged with `release_assignments`.
- **Hourly job:** removes an expired link and its members (not `joined_by_link = false`
  members, not live or never-expiring links); deletes invites at 30 days and not a second
  earlier, never `ACTIVE` rows; deletes usage older than 30 days and keeps the boundary
  day. Tests write past timestamps and pass `at`; they never fake the clock.
- **Web:** the select defaults to 30 days; changing to never sends `expiresIn: 'NEVER'`; the
  expiry and warning lines render; a link member shows "Joined by link".
- **E2E** (`apps/web/e2e/share.spec.ts`): create a link with 7 days, see the date; change it to
  never, see "Never expires". No second-user step (CI has one Auth0 test account; owner,
  2026-11-04).

## What this design leaves out on purpose

Cut on 2026-11-04 to keep maintenance low; each can be added later if a real need appears:

- Expiry checks in access control, member lists and invite claiming (the hourly job is
  enough; see "How expiry works").
- "Last used", an "Invite expires on" line, restarting an invite's
  30 days on re-invite, warnings before expiry, a separate "link expired" page.
- Storing the chosen duration next to `expires_at`, extra check constraints, a shared
  retention-constants module, query helpers for expiry.
- Copying vendor retention periods into Wally's docs.
- An invitation email (Wally sends no email yet).
- GAP-08's other half (whether history should record the actor at all).

## Constraints

- **Build after the account deletion PR merges.** Both change `boards.ts`, the
  `purge_expired()` migration chain, the privacy text and GDPR.md. This work's migrations
  take the next free numbers and redefine `purge_expired()` from whatever the deletion work
  left.
- English identifiers and stored values; German only in the catalogues (ADR-0014).
- E2E specs in the PR and green CI before it is ready; no stacked PRs.
- No new services or jobs; the existing hourly job does the cleanup.
- Never log a share-link token.

## Usage counters (owner, 2026-11-04)

Per-user assistant usage counters are kept 30 days: the daily limit needs only today's row,
and cost is tracked without naming anyone in `assistant_spend` (monthly totals). This
replaces the earlier choice of 12 months.

## Claude's calls (the owner can overrule any)

1. Changing a link's expiry counts from the change; changing only its role leaves it alone.
2. Regenerating a link keeps its end date.
3. Members who exist before the release count as invited, so nobody loses access at the
   release.
4. An email invite makes a link member permanent.
5. Vendor rows link to the vendor's own documentation instead of copying periods.
