# GDPR / DSGVO

What Wally does with personal data, which obligations the code already meets, and what is
still missing. Written to be worked through item by item: every gap has an id, the article
it comes from, the evidence that it is real, and a concrete plan.

Two things this document is not. It is not legal advice — the assessments here are
engineering judgements about code, and the controller's own privacy function has the last
word. And it is not complete on its own: roughly a third of GDPR compliance for an app like
Wally lives outside the repository (§8), and no amount of code review closes those items.

**Status: 2 of 13 closed (GAP-03 pending the controller's review of the notice text, ORG-04), 1 not applicable.** Update the checklist in §7 as they land.

---

## 1. Roles and scope

| Role          | Who                                                                                                                                                                                                                                                                                        | Basis                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Controller    | Luminull                                                                                                                                                                                                                                                                                   | Decides why and how to-do data is processed |
| Processor     | Google (Cloud Run, Firebase Hosting, Cloud Logging, Secret Manager, Vertex AI; Cloud Firestore until the PostgreSQL release; Firebase Auth for local and CI sign-in, not production), Auth0 (production sign-in for web and MCP) and, from the PostgreSQL release, Supabase (the database) | Processes on the controller's instructions  |
| Data subjects | People using Wally, plus non-users invited by email                                                                                                                                                                                                                                        |                                             |

Wally is a shared to-do tool with per-user accounts and board sharing, run by Luminull as a
side project. It is a standalone application and not part of any other product.

Because it is not an employer rolling a tool out to staff, the employment-law reading does
not apply: there is no works council (ORG-03) and no employee-monitoring angle. The likely
basis is Art. 6(1)(b) — processing necessary to provide the service the user signed up for —
with Art. 6(1)(f) covering the security measures in §3. Consent is still the wrong answer,
because none of this processing is optional to the service.

One caveat worth recording: the **household exemption in Art. 2(2)(c) does not apply.** As
soon as Wally has accounts for people other than its author and lets them share boards, it
is outside purely personal activity, and the full regulation applies regardless of the
project's size or commercial status.

No special-category data (Art. 9) is processed by design. Note titles and custom fields are
free text, so a user _can_ type health or other sensitive information into one; the
mitigation is organisational (§8), not technical.

---

## 2. Data inventory (Art. 30)

Derived from the PostgreSQL schema in
[`apps/api/src/lib/postgres/schema/`](../apps/api/src/lib/postgres/schema/), which is the
single source of truth for stored shapes; field names are the row types' in
[`apps/api/src/lib/db/types.ts`](../apps/api/src/lib/db/types.ts), and columns are their
snake_case form. A new personal-data column is a change to the schema and to this table.

**Where the data lives (2026-10-31).** The code stores everything in PostgreSQL, built for a
Supabase project in Frankfurt that does not exist yet. Production runs v0.11.0, which keeps
the same fields in Cloud Firestore (database `wally`, `europe-west3`) until the release that
ships the PostgreSQL API. Nothing is copied across: PostgreSQL starts empty, and the
Firestore data is deleted when Firestore is decommissioned
([RFC-0011](rfcs/RFC-0011-platform-migration.md) section 6).

### Identity — `users`

| Field                     | Personal data                                                                                                                                                                                                                                                                 | Source                                               | Deleted when       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------ |
| `email`                   | Yes — direct identifier                                                                                                                                                                                                                                                       | Sign-in token (see below), lowercased                | **Never** (GAP-01) |
| `displayName`             | Yes                                                                                                                                                                                                                                                                           | Sign-in token                                        | **Never** (GAP-01) |
| `emailVerified`           | Yes, indirectly                                                                                                                                                                                                                                                               | Sign-in token                                        | **Never** (GAP-01) |
| `language`                | Yes — a preference tied to a person                                                                                                                                                                                                                                           | `Accept-Language` at first sign-in, then `PATCH /me` | **Never** (GAP-01) |
| `preferences`             | Yes — UI choices tied to a person: theme, colour palette, free-canvas background, last opened board, per-board view settings (view, grouping, done/mine/priority filters), and whether WallyBot applies its suggestions automatically (`wallybot.autoApply`). No search text. | `PATCH /me`                                          | **Never** (GAP-01) |
| `createdAt` / `updatedAt` | Yes, indirectly — reveals first use and last profile change                                                                                                                                                                                                                   | Server                                               | **Never** (GAP-01) |
| row id (`uid`)            | Yes — pseudonymous identifier, referenced everywhere                                                                                                                                                                                                                          | Random id, created at first sign-in                  | **Never** (GAP-01) |

Production signs in with Auth0: the sign-in token is an Auth0 access token whose claims come
from [`infra/auth0-post-login.cjs`](../infra/auth0-post-login.cjs), and the uid is a random
Wally id that `resolveOrCreateIdentity`
([`apps/api/src/lib/auth/identities.ts`](../apps/api/src/lib/auth/identities.ts)) creates at
the first sign-in and links to the Auth0 subject in `authIdentities`. Firebase Authentication
signs in local development and CI only; there the token is a Firebase ID token and the uid
is the Firebase uid.

### Membership — `board_members`

| Field                                        | Personal data                                             | Notes                                |
| -------------------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| `userId`                                     | Yes, pseudonymous                                         | Null until the invitee signs up      |
| `invitedEmail`                               | Yes — **and it may belong to someone who has no account** | See GAP-07                           |
| `role`, `status`, `invitedAt`, `activatedAt` | Yes, indirectly                                           | Reveals when a person joined a board |

### Boards — `whiteboards`

| Field                     | Personal data                                 | Deleted when                                      |
| ------------------------- | --------------------------------------------- | ------------------------------------------------- |
| `name`                    | Possibly — free text the owner typed          | The owner deletes the board (`board.delete`)      |
| `ownerId`                 | Yes, pseudonymous                             | The owner deletes the board                       |
| `createdAt` / `updatedAt` | Yes, indirectly                               | The owner deletes the board                       |
| `deletedAt`               | No — marks a board whose cleanup is under way | With the board row, when its cleanup job finishes |

Deleting a board removes its notes (with their subtasks and history), its members and its
share link; the board reads as absent from the commit on, and a durable cleanup job finishes
the physical deletion.

A board's member roles are read from `board_members` each time the board loads (`liveBoard`
in [`apps/api/src/lib/db/records.ts`](../apps/api/src/lib/db/records.ts)). Firestore kept a
copy on the board document; PostgreSQL keeps none, so erasure has one place to clear.

### Content — `notes`, `subtasks` and `note_history`

| Field                                          | Personal data                         | Notes                                                                     |
| ---------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------- |
| `title`, `description`, `tags`, `customFields` | Free text — **may contain anything**  | Not translated, stored as typed                                           |
| `links`                                        | No                                    | Ids of related notes                                                      |
| `assigneeId`, `createdById`                    | Yes, pseudonymous                     | Survives the person's removal from the board                              |
| `visibility`                                   | No                                    | Decides who sees the note; a private note is readable only by its creator |
| `subtasks.text`                                | Free text                             |                                                                           |
| `note_history.actorId` + `occurredAt` + `type` | **Yes — a per-person activity trail** | See GAP-08                                                                |

### Mutation receipts and cleanup jobs

`board_operations`, keyed by user and operation ID, stores a command fingerprint, board ID,
timestamps, committed revision and result for safe retries. Results can include note text,
member data or a share token; these are personal or access-sensitive data even after the
original record is deleted. Rows are deleted seven days after creation by the hourly expiry
purge (below), and with their user (`ON DELETE CASCADE`).

`board_cleanup` stores only IDs, job kind and creation time. Pending deletion or assignment
cleanup jobs have **no expiry**: they are removed only after successful cleanup, so receipt expiry
cannot strand content. Browser drafts and retry state are held in memory and cleared on account
change. Command outcome logs omit note contents and share tokens; redemption URLs are redacted.

### Assistant records

Seven tables ([`apps/api/src/lib/postgres/schema/assistant.ts`](../apps/api/src/lib/postgres/schema/assistant.ts)
and `safety.ts`). The five keyed by user are deleted with their user (`ON DELETE CASCADE`);
`assistant_audit` names users without a foreign key and goes only by expiry.

**Expiry.** The database function `purge_expired()` deletes every row whose `expires_at` has
passed, and the Supabase Cron (pg_cron) job `wally-purge-expired` runs it every hour, inside
PostgreSQL; a SQL migration creates both ([DEPLOY.md](DEPLOY.md#board-safety-rollout)). A
row can outlive its expiry by up to the next run. **To confirm in the hosted project:** that
Supabase Cron runs on the Free plan. Until production switches, the Firestore TTL policies
do this job, usually within 24 hours after `expiresAt`.

| Table                             | Personal data                                                                                                                                                                                                                                       | Deleted when                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `assistant_conversations`         | **Yes — free text.** The user's questions and the assistant's answers (`entries`), the model's own message log (`messages`, which can hold board content the assistant read), linked note ids and titles, board id, model, token usage, timestamps  | Purge, 30 days after the last turn (`CONVERSATION_RETENTION_DAYS`)  |
| `assistant_suggestions`           | **Yes — free text.** Proposed values for one note with the model's reasons (title, description, subtasks, tags, properties, links, a proposed assignee's user id), the note's previous values after a keep, the decision and its time, model, usage | Purge, 7 days after creation (`SUGGESTION_RETENTION_DAYS`)          |
| `assistant_tidies`                | Yes, pseudonymous — note ids and their horizon moves with the model's reasons, the decision and its time, model, usage                                                                                                                              | Purge, 7 days after creation (`SUGGESTION_RETENTION_DAYS`)          |
| `assistant_attempts`              | Yes, indirectly — when the user's model calls ran, their reserved and settled tokens and cost                                                                                                                                                       | Purge, 7 days after creation (`ATTEMPT_RETENTION_DAYS`)             |
| `assistant_usage` (per UTC day)   | Yes, indirectly — the user's tokens per UTC day, and the ids and start times of calls in flight                                                                                                                                                     | **Never** — no expiry (GAP-04)                                      |
| `assistant_audit`                 | Yes, pseudonymous — actor, board and target note ids, command type, conversation, approval or MCP connection id, revision and time. No contents                                                                                                     | Purge, 30 days after the command (`ASSISTANT_AUDIT_RETENTION_DAYS`) |
| `assistant_spend` (per UTC month) | No — the deployment's spend per UTC month                                                                                                                                                                                                           | Never; holds no personal data                                       |

### Elsewhere

- **Auth0** holds the production login identity (see [Auth0 and MCP data](#auth0-and-mcp-data)).
- **Firebase Authentication** signs in local development and CI; it is not a production
  fallback. It holds the CI test accounts, and may still hold the credential records of
  accounts created before Auth0 and Google's own sign-in metadata (last login, provider) that
  Wally never reads. Since the v0.11.0 data reset none of them maps to a Wally account. Not
  checked: whether those records have been deleted. Deleting a `users` row
  touches neither identity store — erasure has to address all three (GAP-01).
- **Cloud Logging** receives the API's own log, which names no caller (§3), and Cloud Run's
  request log, which records each client's IP address and user agent (GAP-05).
- **Browser `localStorage`** holds `wally.language`
  ([`apps/web/src/i18n/storage.ts`](../apps/web/src/i18n/storage.ts)), `wally.theme` and
  `wally.palette` ([`apps/web/src/lib/theme.tsx`](../apps/web/src/lib/theme.tsx)), a list-view
  hint flag
  ([`apps/web/src/features/board/ListView/ListView.tsx`](../apps/web/src/features/board/ListView/ListView.tsx))
  and `wally.auth0.logout`, the time of the last sign-out, which signs out the app's other tabs
  ([`apps/web/src/features/auth/Auth0SessionProvider.tsx`](../apps/web/src/features/auth/Auth0SessionProvider.tsx)).
  The Auth0 SPA SDK (`@auth0/auth0-spa-js` 2.29.0, read in its source) keeps the sign-in
  transaction (`a0.spajs.txs.<client id>`) across the login redirect and sets an
  `auth0.<client id>.is.authenticated` cookie; its tokens stay in memory. All of these are
  strictly functional.

### Who can see what

A board member sees the **email address and display name of every other member** of that
board, including invitees who have not signed up — see `toMemberDto`
([`apps/api/src/lib/dto.ts`](../apps/api/src/lib/dto.ts)) and `ownerMemberDto`
(same file). This is necessary for the
assignee picker and is not a defect, but it is a disclosure that belongs in the privacy
notice (GAP-03).

Private notes are the exception: only their creator receives them from the API.

---

## 3. Covered — verified in the code

These need no work. They are listed so a future reviewer does not re-derive them, and so a
regression is visible as a change to a named file.

### Data residency stays in the EU

The database is planned in Supabase's Frankfurt region ([`DEPLOY.md`, Create the database](DEPLOY.md#4-step-2--create-the-database)),
the connection-string secret is replicated only in `europe-west1`, and everything else on
Google Cloud is `europe-west1` (Belgium) ([`DEPLOY.md`, Names used throughout](DEPLOY.md#names-used-throughout)).
Until the PostgreSQL release, production's Firestore is `europe-west3` (Frankfurt)
([`DEPLOY.md`, Firestore in production until the switch](DEPLOY.md#firestore-in-production-until-the-switch)).
No third-country transfer to assess under Chapter V. Not yet checked: the region of the
hosted Supabase project, which does not exist yet. _(Art. 44 ff.)_

Logs are the exception: Cloud Logging creates its default log buckets in the `global`
location, which Google does not tie to a region (GAP-05).

### The API's request log names no caller

Each request log line records the method and the path, and nothing else: no client address,
port, host or header. The query string is dropped and share-link tokens are redacted —
`requestLogSerializers` in [`apps/api/src/app.ts`](../apps/api/src/app.ts), replacing
Fastify's default serializer, which writes the client's address. Pinned by
[`apps/api/test/logging.test.ts`](../apps/api/test/logging.test.ts). Checked on 2026-10-14
against 2,000 lines from the running development API: no IP address, no authorization or
cookie header. Board-command lines add the command, operation ID, board ID and outcome.

Paths and command lines do carry resource IDs, and a user's first board has their Wally user
id as its ID — a pseudonymous identifier, accepted because it identifies no one without the
`users` table. _(Art. 5(1)(c))_

### No processors beyond Google, Auth0 and Supabase

[`apps/web/package.json`](../apps/web/package.json) carries no analytics, tag manager, error
reporter or session recorder. Google and Auth0 are the only processors today; Supabase joins them with
the PostgreSQL release, which makes three Art. 28 relationships. _(Art. 28)_

### No consent banner is required

The only client-side storage is the language, theme and palette preferences, a UI hint flag, a
sign-out signal between tabs and the Auth0 SDK's login state (§2, "Elsewhere"), all strictly
necessary for a service the user explicitly asked for — outside the consent requirement of
§25(1) TTDSG. A cookie banner here would be noise, not compliance. _(TTDSG §25(2))_

### The database is closed to direct client access

Only the API connects to the database, with the connection string Cloud Run reads from Secret
Manager. The web app holds no database client; every request passes the API's role checks in
[`apps/api/src/lib/authorization.ts`](../apps/api/src/lib/authorization.ts). Every table has Row
Level Security enabled with no policies, which denies every row to any role row security
applies to ([row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)), and
Supabase's Data API is to be switched off
([DEPLOY.md](DEPLOY.md#4-step-2--create-the-database)). **Not yet verified in production:**
both are settings of a hosted project that does not exist yet. Until the PostgreSQL release,
production's `firestore.rules`, deployed earlier, deny every direct read and write.
_(Art. 32(1)(b))_

### Privilege decisions keyed on email require a verified address

An invite can only be claimed once the sign-in provider (Auth0 in production, Firebase
locally and in CI) confirms the caller controls the address —
the `emailVerified` check before `activatePendingInvitesForEmail` in
[`apps/api/src/plugins/auth.ts`](../apps/api/src/plugins/auth.ts), with the reasoning
recorded on the `users.emailVerified` column. Without it, anyone could claim a colleague's pending
invite by typing their address at signup. This is a real unauthorised-disclosure control.
_(Art. 32(1)(b))_

### Share tokens are not guessable

24 cryptographically random bytes — `generateShareToken` in
[`apps/api/src/lib/tokens.ts`](../apps/api/src/lib/tokens.ts).
_(Art. 32)_

### Deleting a note removes everything under it

Subtasks and history are deleted with their note, and a board's members, share link and notes
with the board (`ON DELETE CASCADE`) — the `note.delete` and `board.delete` cleanup in
`drainCleanupJob`,
[`apps/api/src/lib/commands/maintenance.ts`](../apps/api/src/lib/commands/maintenance.ts). No orphaned history
rows pointing at a person. _(Art. 17(1))_

### Removing a member releases their assignments

Their notes fall back to unassigned, but only once they have genuinely lost all access —
the `member.remove` cleanup in `drainCleanupJob`,
[`apps/api/src/lib/commands/maintenance.ts`](../apps/api/src/lib/commands/maintenance.ts). _(Art. 5(1)(c))_
A removed member's private notes are kept, hidden from everyone, and become visible to them again if they rejoin. They are deleted with the rest of the account once account deletion (GAP-01) exists.

### Browser locale is not used as an ongoing tracking signal

`Accept-Language` is read once, at provisioning, and never again — the reasoning is on
[`apps/api/src/lib/language.ts`](../apps/api/src/lib/language.ts) and the property is
grep-verifiable. _(Art. 5(1)(c))_

### Rate limiting is keyed on identity, not IP

The rate limiter's `keyGenerator` in [`apps/api/src/app.ts`](../apps/api/src/app.ts) keys on the authenticated user id and only
falls back to `request.ip` for unauthenticated requests, so no per-IP profile is built for
signed-in users. _(Art. 5(1)(c))_

### Secrets are not committed

`.env` and `.env.*` are ignored, `.env.example` carries no values
([`.gitignore`](../.gitignore)). Service-account keys never enter git. _(Art. 32)_

---

## 4. Gaps — data subject rights

### GAP-01 — No way to delete an account or its data · **High** · Art. 17

No `DELETE /me`. An owner can now delete each of their boards (`board.delete`) and a member
can leave a shared one (`board.leave`), but nothing removes the account itself. A departing
employee's `users` row, any board they did not delete, their `createdById` and `assigneeId`
references and their `history.actorId` entries persist forever. Firebase Auth and Auth0 each
hold a further copy of the identity, independent of the database.

**Status:** a self-service deletion flow was built, then removed in PR #76 because it was
too complex to maintain. Until it is rebuilt, deletion requests to
privacy@luminull.com are handled by hand. The Account and data page says so.

**Plan.** Rebuild `DELETE /me`, plus an admin-invocable equivalent for someone who has
already lost their login, on PostgreSQL after the platform migration, against the new
schema ([RFC-0008](rfcs/RFC-0008-firestore-to-supabase.md)). The erasure-vs-anonymisation
decision in §6 applies, and the routine must also remove the identity at the sign-in
provider.

### GAP-02 — No data export · **High** · Art. 15, 20

No export endpoint. A subject access request can only be answered today by someone querying
the database by hand, which does not scale and is error-prone. A first export
endpoint was removed in PR #76, to be rebuilt with deletion. Until then, requests to
privacy@luminull.com are answered by hand.

**Plan.** `GET /me/export` returning JSON: the profile, every board the user owns or belongs
to, their notes and subtasks, their history events, and their membership rows. Reuse the DTO
mappers so the export cannot drift from the API's own view. Machine-readable and structured
satisfies Art. 20; a ZIP is unnecessary at this data volume.

### GAP-03 — Privacy notice · ~~**High**~~ · Art. 13 · **resolved, pending the controller's review**

**Resolved in code since v0.8.1.** `/privacy`
([`apps/web/src/routes/PrivacyPage.tsx`](../apps/web/src/routes/PrivacyPage.tsx)) shows a
notice in **both DE and EN** (the `privacy` messages in `apps/web/src/i18n/de.ts` and
`en.ts`). It is linked from the sign-in and sign-up layout
([`AuthLayout.tsx`](../apps/web/src/routes/AuthLayout.tsx)), the one surface an
unauthenticated person sees, and from the Account and data page
([`AccountPage.tsx`](../apps/web/src/routes/AccountPage.tsx)), which the account menu opens.
It names the operator and contact, the data processed, the member-visibility disclosure from
§2, the sign-in, hosting and AI providers, that boards and cards do not expire, and the
rights.

**Still open:** the text has not been reviewed by the controller (ORG-04). It says itself
that provider arrangements, transfer safeguards and legal bases await the operator's
approval, and it cannot state retention periods until GAP-04 sets them.

---

## 5. Gaps — data lifecycle and security

### GAP-04 — No retention policy anywhere · **High** · Art. 5(1)(e)

No user content expires. The hourly expiry purge (`purge_expired()`, §2) covers only command
receipts and assistant records, kept seven or 30 days
([`DEPLOY.md`](DEPLOY.md#board-safety-rollout)). Completed notes, history events,
membership rows, daily assistant usage counters and user profiles accumulate indefinitely. Storage limitation is not optional, and "we never delete"
is the clearest possible failure of it.

**Plan.** Agree a retention period per category with the controller (§8), then enforce it in
code rather than documenting an intention. Suggested starting point: completed notes 24
months after `completedAt`; history events 12 months after `occurredAt`; PENDING invites 90
days after `invitedAt` (GAP-07); user profiles deleted on offboarding (GAP-01). Where the
retention job runs is open: the Supabase Cron job that runs the expiry purge is one place, the
planned background service another (RFC-0011 workstream 5).

### GAP-05 — Cloud Run's request log records client IP addresses, in a log bucket outside the EU regions · **Medium** · Art. 5(1)(c), (e), 44 · **deferred**

The API's own log no longer records who called it (§3, "The API's request log names no
caller"; fixed in `df717400`, pinned by a test). What is left is outside the code, in Google
Cloud.

**Evidence**, from Google's documentation on 2026-10-14:

- Cloud Run writes a request log for every request to a service: "These logs are created
  automatically." Cloud Run cannot turn them off; a Cloud Logging exclusion filter can
  ([Cloud Run logging](https://docs.cloud.google.com/run/docs/logging)).
- Each entry's `httpRequest.remoteIp` is, in Google's words, "The IP address (IPv4 or IPv6)
  of the client that issued the HTTP request." Entries also carry `userAgent`, `referer` and `requestUrl` with the
  query ([LogEntry reference](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry)). Google's own parser for Cloud Run logs reads
  `httpRequest.remoteIp` from them ([Cloud Run log parser](https://docs.cloud.google.com/chronicle/docs/ingestion/default-parsers/cloudrun)). IP addresses are online
  identifiers that can identify a person ([Recital 30](https://gdpr-info.eu/recitals/no-30/)).
- They are kept in the project's `_Default` log bucket: 30 days by default, configurable from 1
  to 3,650 days ([Logging quotas](https://docs.cloud.google.com/logging/quotas)).
- The `_Default` and `_Required` buckets "are in the `global` location", and "You can't change
  the location of existing buckets" ([regionalized logs](https://docs.cloud.google.com/logging/docs/regionalized-logs)). Google does not say where
  `global` data is stored, so the EU-only statement in §3 does not cover logs.
- Firebase Hosting can export its request logs, with client IP, city and country, but only
  once the integration is linked in the Firebase console ([Hosting logs](https://firebase.google.com/docs/hosting/web-request-logs-and-metrics)).
- The rate limiter keys requests without a signed-in user by IP address, in process memory, per
  instance, for its one-minute window; it stores and logs nothing (`buildApp`).

**Checked on the project, 2026-10-14:** `luminull-wally`'s `_Default` bucket is
`projects/luminull-wally/locations/global/buckets/_Default`, with `retentionDays: 30` — so
request logs with client IP addresses are kept 30 days, in the `global` location:

```bash
gcloud logging buckets describe _Default --location=global --project=luminull-wally
```

**Not verified first-hand:** whether Firebase Hosting request logs are linked to Cloud Logging.

**Deferred** by the controller on 2026-10-14, to be done later. Until then, Cloud Run's request
logs, with client IP addresses, are kept 30 days in the `global` bucket. Nothing else in this
document waits on it.

**Cost:** none extra. Cloud Logging charges for logs stored (the first 50 GiB per project and
month are free) and for retention beyond 30 days, the same for the `_Default` bucket and
user-defined ones; excluded logs are never stored, so step 1 lowers the volume, and step 2
keeps the free 30 days ([Observability pricing](https://cloud.google.com/products/observability/pricing),
[estimating bills](https://docs.cloud.google.com/stackdriver/estimating-bills)). The pricing
page only renders in a browser; its figures were read from Google's search listing.

**Plan.** These are project settings for whoever deploys, in this order, not code changes.

1. **Exclude Cloud Run's request log.** The API's own log already records method, path, status
   and response time for every request it answers, without the caller's address, so the
   platform log adds mainly the IP address and user agent. An exclusion on the `_Default` sink
   stops it being stored ([`gcloud logging sinks update`](https://docs.cloud.google.com/sdk/gcloud/reference/logging/sinks/update)):

   ```bash
   gcloud logging sinks update _Default --project=luminull-wally \
     --add-exclusion=name=cloud-run-requests,filter='logName="projects/luminull-wally/logs/run.googleapis.com%2Frequests"'
   ```

   The cost: a request Cloud Run rejects before the API answers it, for example when no
   instance can start, no longer leaves a request log line.

2. **Keep the remaining logs in the EU.** Create a log bucket in `europe-west1` and point the
   `_Default` sink at it ([`gcloud logging buckets create`](https://docs.cloud.google.com/sdk/gcloud/reference/logging/buckets/create), [bucket destinations](https://docs.cloud.google.com/logging/docs/export/configure_export_v2)):

   ```bash
   gcloud logging buckets create wally-eu --location=europe-west1 --retention-days=30 --project=luminull-wally
   gcloud logging sinks update _Default logging.googleapis.com/projects/luminull-wally/locations/europe-west1/buckets/wally-eu --project=luminull-wally
   ```

   Entries already in the `global` bucket stay there until its retention expires them. The
   `_Required` bucket cannot move; it holds Admin Activity, System Event and Access
   Transparency audit logs ([routing overview](https://docs.cloud.google.com/logging/docs/routing/overview)), which record administrators' actions,
   not app users'.

3. **Then record it.** Put the exclusion, the bucket and its retention in `DEPLOY.md`, and
   close this gap. If request logs with IP addresses are kept instead, the privacy notice
   (GAP-03) has to say so, with the security purpose ([Recital 49](https://gdpr-info.eu/recitals/no-49/)) and the retention.
   That is the controller's decision.

The recitals were read on gdpr-info.eu; the official EUR-Lex page did not load for checking.

### GAP-06 — Share links never expire and are not auditable · **Medium** · Art. 5(1)(e), 32

`share_links` has no expiry column and no usage record
([`apps/api/src/lib/postgres/schema/boards.ts`](../apps/api/src/lib/postgres/schema/boards.ts)). A link handed out once grants
access until someone remembers to revoke it, and nobody can tell who redeemed it. The token
itself is strong; the lifecycle around it is not.

**Plan.** Add `expiresAt` (default 30 days, enforced at redemption, surfaced in the UI) and
`lastRedeemedAt`. Do not log the token value itself.

### GAP-07 — Emails of people who never signed up are kept indefinitely · **Medium** · Art. 5(1)(e), 14

`board_members.invitedEmail` stores the address of an invited non-user. That person has no
account, no way to exercise their rights, and — because the data was not collected from them
— is owed an Art. 14 notice Wally has no channel to deliver.

**Plan.** Expire PENDING invites (see GAP-04) so the address does not outlive the invitation.
Include the invitation's purpose and retention in the invitation email itself, which is the
only channel that reaches a non-user. Confirm with the controller whether inviting external
addresses is permitted at all.

### GAP-08 — Note history is per-person activity data · **Medium** · Art. 5(1)(b) · **and see §8**

Every history event records `actorId` and `occurredAt`
(both history writes in `executeNoteCommand`,
[`apps/api/src/lib/commands/notes.ts`](../apps/api/src/lib/commands/notes.ts)). Only `CREATED` and `MOVED` exist today
(`noteHistoryEventTypeValues` in
[`packages/shared/src/enums.ts`](../packages/shared/src/enums.ts)), so the trail is
narrow — but it is still a timestamped record of who did what, retained forever, and
[`docs/SPEC.md`](SPEC.md) §10 justifies it only as "informational".

**Plan.** State the purpose explicitly in the spec and the privacy notice; apply the
retention from GAP-04; and treat any new event type as a change that needs re-assessment
rather than a routine enum addition. **The co-determination question in §8 is the more
consequential one, and it should be answered before this ships.**

### GAP-09 — No documented technical and organisational measures · **Low** · Art. 32

The measures in §3 are real and well-reasoned, but they exist only as code comments. An
auditor asking "what are your TOMs" has nothing to read.

**Plan.** §3 of this document is the first draft. Move it into whatever TOM register the
controller keeps, and link back here.

### GAP-10 — Seed and fixture data used real-looking people on a real company's domain · ~~**Low**~~ · **CLOSED**

`apps/api/src/seed.ts` seeded four accounts whose names looked like real people, on the
email domain of an existing company unrelated to this project. The same addresses were
repeated across the frontend fixtures, component tests, the API test suite and the e2e
setup — part of 170 occurrences across 25 files that also included **user-visible UI
copy**: the invite
field's placeholder in both message catalogues read `name@<that company>.de`.

**Closed.** All four seeded people were replaced with invented names, and every address in
the repository now sits on `@example.com`, which RFC 2606 reserves so it can never route.
Git history still contains the originals; rewriting it was judged disproportionate, and
this sentence is the record of that decision.

---

## 6. Decisions needed before building

These block implementation. They are product and legal calls, not engineering ones.

1. **Erasure vs. anonymisation for content on other people's boards.** If Lena is deleted,
   does the note she created on Max's board vanish, or stay with an anonymous author? Hard
   deletion destroys a colleague's work; anonymisation retains a pseudonymous record.
   Recommendation: anonymise. Needs sign-off.
2. **Retention periods** per category (GAP-04). Engineering can enforce any number; it cannot
   choose it.
3. **Offboarding trigger.** Does deletion happen when the upstream account is disabled, on
   request, or on a schedule? This decides whether GAP-01 needs an admin endpoint as well as
   a self-service one.
4. **External invitees.** Permitted, or restricted to the operator's own email domain? A
   one-line check in `upsertInvite` if restricted, and it removes most of GAP-07.

---

## 7. Work plan

Ordered by dependency, not by severity — §6 and the notice gate the rest, and the retention
job needs a scheduler that does not exist yet.

| #     | Item                                                  | Gap            | Depends on        |
| ----- | ----------------------------------------------------- | -------------- | ----------------- |
| 1     | Answer the four decisions                             | —              | §6                |
| 2     | Platform request log and EU log bucket — **deferred** | GAP-05         | —                 |
| 3     | Data export endpoint                                  | GAP-02         | RFC-0008          |
| 4     | Account deletion                                      | GAP-01         | 1, RFC-0008       |
| 5     | Share-link expiry                                     | GAP-06         | —                 |
| 6     | Retention job + invite expiry                         | GAP-04, GAP-07 | 1, scheduler      |
| ~~7~~ | ~~Privacy notice route, DE + EN~~ — **done**          | GAP-03         | controller's text |
| 8     | History purpose in spec + notice                      | GAP-08         | —                 |
| ~~9~~ | ~~Seed data cleanup~~ — **done**                      | GAP-10         | —                 |
| 10    | TOM register                                          | GAP-09         | —                 |

Items 2 and 5 have no external dependency. Item 5 can start immediately; items 3 and 4 are
rebuilt on PostgreSQL after the migration (RFC-0008); item 2 is deferred (GAP-05) and,
when picked up, is three `gcloud` commands with no code change and no extra cost. Items 7 and
9 are done; item 7's text still awaits the controller's review (ORG-04).

### Checklist

- [ ] GAP-01 Account deletion (Art. 17)
- [ ] GAP-02 Data export (Art. 15, 20)
- [x] GAP-03 Privacy notice (Art. 13) — `/privacy` live since v0.8.1; text pending the controller's review (ORG-04)
- [ ] GAP-04 Retention policy (Art. 5(1)(e))
- [ ] GAP-05 Platform request log and EU log bucket (Art. 5(1)(c), 44) — **deferred** 2026-10-14; the API's own log is done
- [ ] GAP-06 Share-link expiry (Art. 5(1)(e), 32)
- [ ] GAP-07 Invite expiry (Art. 5(1)(e), 14)
- [ ] GAP-08 History purpose (Art. 5(1)(b))
- [ ] GAP-09 TOM documentation (Art. 32)
- [x] GAP-10 Seed data (Art. 5(1)(c)) — closed
- [ ] ORG-01 Lawful basis recorded (Art. 6) — controller answered: Luminull
- [ ] ORG-02 Google DPA in place (Art. 28)
- [x] ORG-03 Works-council agreement (BetrVG §87(1)(6)) — not applicable, see ORG-03

---

## 8. Outside the code

No commit closes these. They belong to the controller, and they are listed because an audit
will ask for them regardless of how clean the repository is.

### ORG-01 — Lawful basis · Art. 6 · _controller answered_

The controller is Luminull (§1). What remains is to record the Art. 6 basis in writing —
Art. 6(1)(b) for the service itself, Art. 6(1)(f) for the security measures — and to note
why consent was not used. A short written record is enough; the absence of one is the gap.

### ORG-02 — Processor agreement with Google · Art. 28

Accept Google's Cloud Data Processing Addendum for the `luminull-wally` project and file it.
Also add Google to the processor register with the EU regions from §3. This applies to a
side project exactly as it does to a company — Art. 28 has no size threshold. Supabase needs
the same review (agreement, region, subprocessors) before the PostgreSQL release, as Auth0
does below.

### ORG-03 — Works-council agreement · BetrVG §87(1)(6) · **not applicable**

Closed by ORG-01: Luminull runs Wally as a side project, not as an employer deploying a
tool to staff, so there is no works council and no co-determination right to trigger.

Recorded rather than deleted, because it revives the moment an employer adopts Wally for
its own people. The history trail (GAP-08) makes the system _capable_ of monitoring who did
what and when, and under BetrVG §87(1)(6) capability is the test, not intent. Anyone
proposing Wally as an internal workplace tool has to answer this before rollout — it is not
GDPR, it is enforced independently, and a rollout without agreement can be stopped after the
fact.

### ORG-04 — Privacy notice text · Art. 13

Engineering shipped a notice at `/privacy` (GAP-03); the controller has yet to review its
text. It must cover the member-visibility disclosure in §2 and the retention periods from
GAP-04.

### ORG-05 — Do we need a DPIA? · Art. 35

Almost certainly not, now that the employee-monitoring reading is off the table (ORG-03):
small scale, no special-category data by design, no automated decision-making, no
systematic monitoring of a public area. Write the _assessment_ down anyway — a documented
"no" is compliant, silence is not, and it is three sentences.

### ORG-06 — Breach procedure · Art. 33, 34

72 hours to notify the supervisory authority. Changes ship through CI
([`ci.yml`](../.github/workflows/ci.yml)) and an approval-gated release workflow
([`release.yml`](../.github/workflows/release.yml)), but neither detects or reports an
incident, so it is worth writing down who notices one, who decides, and who reports.

### ORG-07 — Add Wally to the record of processing · Art. 30

§2 is the inventory. It needs to land in the controller's central register, not only here.

---

## Auth0 and MCP data

Production signs users in through Auth0 ([AUTH0.md](AUTH0.md)).

**`auth_identities`:**

- Holds the issuer, the provider subject, the stable Wally user ID and a creation
  timestamp.
- These are personal identifiers. No password, token or email is stored.
- The server reads them to resolve every signed-in request.
- Erasure must remove them, along with the Auth0 user and the application records
  (GAP-01).

**Auth0 as a processor:** Auth0 holds a copy of every user's login identity. Its DPA,
tenant region, subprocessors and retention still need review, as for Google in ORG-02.

MCP adds private `mcp_connections` rows containing client identifier, access
scope ceiling, creation time and revocation time. Connections use current Wally permissions
across all accessible boards. No selected-board list or board-level MCP policy is stored. A bounded rolling
`mcp_limits` row of kind `writes` supports shared write limits; a second, of kind
`requests`, bounds authenticated requests across API instances. Command audit entries
identify the MCP connection. No access/refresh tokens are stored in these records.
These records require inclusion in account/board erasure and export procedures; revoked
connection retention still needs an operational policy; MCP is live in production.

New external AI connections inherit the user's current board membership and role after
OAuth approval; a separate board-owner approval is not required. Host-visible
content follows current membership and note privacy. Users must be told that content
from accessible boards can be processed by their external AI host; host retention
and training terms are separate from Wally's. Write permission does not permit deletion
or sharing administration. Revoking in Wally blocks subsequent calls and transactional
writes/replays, but cannot retract content already delivered to the host.
