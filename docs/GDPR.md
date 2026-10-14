# GDPR / DSGVO

What Wally does with personal data, which obligations the code already meets, and what is
still missing. Written to be worked through item by item: every gap has an id, the article
it comes from, the evidence that it is real, and a concrete plan.

Two things this document is not. It is not legal advice — the assessments here are
engineering judgements about code, and the controller's own privacy function has the last
word. And it is not complete on its own: roughly a third of GDPR compliance for an app like
Wally lives outside the repository (§8), and no amount of code review closes those items.

**Status: 1 of 13 closed, 1 not applicable.** Update the checklist in §7 as they land.

---

## 1. Roles and scope

| Role          | Who                                                               | Basis                                       |
| ------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| Controller    | Luminull                                                          | Decides why and how to-do data is processed |
| Processor     | Google (Firebase Auth, Cloud Firestore, Cloud Run, Cloud Logging) | Processes on the controller's instructions  |
| Data subjects | People using Wally, plus non-users invited by email               |                                             |

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

Derived from [`apps/api/src/lib/db/types.ts`](apps/api/src/lib/db/types.ts), which is the
single source of truth for stored shapes. Firestore is schemaless, so this table and that
file must be kept in step — a new personal-data field is a change to both.

### Identity — `users/{uid}`

| Field                     | Personal data                                                                                                                                                                  | Source                                               | Deleted when       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------ |
| `email`                   | Yes — direct identifier                                                                                                                                                        | Firebase ID token, lowercased                        | **Never** (GAP-01) |
| `displayName`             | Yes                                                                                                                                                                            | Firebase ID token                                    | **Never** (GAP-01) |
| `emailVerified`           | Yes, indirectly                                                                                                                                                                | Firebase ID token                                    | **Never** (GAP-01) |
| `language`                | Yes — a preference tied to a person                                                                                                                                            | `Accept-Language` at first sign-in, then `PATCH /me` | **Never** (GAP-01) |
| `preferences`             | Yes — UI choices tied to a person: theme, free-canvas background, last opened board, and per-board view settings (view, grouping, done/mine/priority filters). No search text. | `PATCH /me`                                          | **Never** (GAP-01) |
| `createdAt` / `updatedAt` | Yes, indirectly — reveals first use and last profile change                                                                                                                    | Server                                               | **Never** (GAP-01) |
| document id (`uid`)       | Yes — pseudonymous identifier, referenced everywhere                                                                                                                           | Firebase Auth                                        | **Never** (GAP-01) |

### Membership — `whiteboards/{id}/members/{id}`

| Field                                        | Personal data                                             | Notes                                |
| -------------------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| `userId`                                     | Yes, pseudonymous                                         | Null until the invitee signs up      |
| `invitedEmail`                               | Yes — **and it may belong to someone who has no account** | See GAP-07                           |
| `role`, `status`, `invitedAt`, `activatedAt` | Yes, indirectly                                           | Reveals when a person joined a board |

### Boards — `whiteboards/{id}`

| Field                     | Personal data                                 | Deleted when                                                             |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `name`                    | Possibly — free text the owner typed          | The owner deletes the board (`board.delete`)                             |
| `ownerId`, `memberRoles`  | Yes, pseudonymous                             | The owner deletes the board; a `memberRoles` key when that member leaves |
| `createdAt` / `updatedAt` | Yes, indirectly                               | The owner deletes the board                                              |
| `deletedAt`               | No — marks a board whose cleanup is under way | With the board document, when its cleanup job finishes                   |

Deleting a board removes its notes (with their subtasks and history), its members and its
share link; the board reads as absent from the commit on, and a durable cleanup job finishes
the physical deletion.

`whiteboards/{id}.memberRoles` is a denormalised `uid -> role` cache of the same facts. Any
erasure work has to clear both, in one transaction — the invariant is already documented on
`WhiteboardDoc.memberRoles` and enforced in [`apps/api/src/lib/members.ts`](apps/api/src/lib/members.ts).

### Content — `notes/{id}` and subcollections

| Field                                          | Personal data                         | Notes                                        |
| ---------------------------------------------- | ------------------------------------- | -------------------------------------------- |
| `title`, `tags`, `customFields`                | Free text — **may contain anything**  | Not translated, stored as typed              |
| `assigneeId`, `createdById`                    | Yes, pseudonymous                     | Survives the person's removal from the board |
| `subtasks/{id}.text`                           | Free text                             |                                              |
| `history/{id}.actorId` + `occurredAt` + `type` | **Yes — a per-person activity trail** | See GAP-08                                   |

### Mutation receipts and cleanup jobs

`users/{uid}/boardOperations/{operationId}` stores a command fingerprint, board ID, timestamps,
committed revision and result for safe retries. Results can include note text, member data or a
share token; these are personal or access-sensitive data even after the original record is deleted.
The `expiresAt` Firestore TTL policy targets seven days; physical deletion is asynchronous.
Any account-erasure routine must recursively remove these user subcollections too.

`boardCleanup/{id}` stores only IDs, job kind and creation time. Pending deletion or assignment
cleanup jobs have **no TTL**: they are removed only after successful cleanup, so receipt expiry
cannot strand content. Browser drafts and retry state are held in memory and cleared on account
change. Command outcome logs omit note contents and share tokens; redemption URLs are redacted.

### Elsewhere

- **Firebase Authentication** holds the credential record, and Google's own sign-in metadata
  (last login, provider) that Wally never reads. Deleting a Firestore user document does not
  touch it — erasure has to address both stores (GAP-01).
- **Cloud Logging** receives Fastify's request log, which includes client IP addresses
  (GAP-05).
- **Browser `localStorage`** holds `wally.language`
  ([`apps/web/src/i18n/storage.ts`](apps/web/src/i18n/storage.ts)), `wally.theme`
  ([`apps/web/src/lib/theme.tsx`](apps/web/src/lib/theme.tsx)) and a list-view hint flag
  ([`apps/web/src/features/board/ListView/ListView.tsx`](apps/web/src/features/board/ListView/ListView.tsx)).
  All three are strictly functional.

### Who can see what

A board member sees the **email address and display name of every other member** of that
board, including invitees who have not signed up — see `toMemberDto`
([`apps/api/src/lib/dto.ts:156`](apps/api/src/lib/dto.ts:156)) and `ownerMemberDto`
([`apps/api/src/lib/dto.ts:183`](apps/api/src/lib/dto.ts:183)). This is necessary for the
assignee picker and is not a defect, but it is a disclosure that belongs in the privacy
notice (GAP-03).

---

## 3. Covered — verified in the code

These need no work. They are listed so a future reviewer does not re-derive them, and so a
regression is visible as a change to a named file.

### Data residency stays in the EU

Firestore is `europe-west3` (Frankfurt) and everything else `europe-west1` (Belgium) —
[`docs/DEPLOY.md:117`](docs/DEPLOY.md:117) and [`docs/DEPLOY.md:74`](docs/DEPLOY.md:74). No
third-country transfer to assess under Chapter V, and `DEPLOY.md` already warns that a
database's location is permanent. _(Art. 44 ff.)_

### No third-party processors beyond Google

[`apps/web/package.json`](apps/web/package.json) carries no analytics, tag manager, error
reporter or session recorder. Google is the sole processor, which keeps Art. 28 to a single
relationship. _(Art. 28)_

### No consent banner is required

The only client-side storage is the language and theme preferences and a UI hint flag, all strictly
necessary for a service the user explicitly asked for — outside the consent requirement of
§25(1) TTDSG. A cookie banner here would be noise, not compliance. _(TTDSG §25(2))_

### The database is closed to direct client access

[`firestore.rules`](firestore.rules) denies every read and write. The web app holds no
Firestore client; every request passes the API's role checks in
[`apps/api/src/lib/authorization.ts`](apps/api/src/lib/authorization.ts). The rules file says
in its own comment that this is the intended posture, not a placeholder. _(Art. 32(1)(b))_

### Privilege decisions keyed on email require a verified address

An invite can only be claimed once Firebase confirms the caller controls the address —
[`apps/api/src/plugins/auth.ts:231`](apps/api/src/plugins/auth.ts:231), with the reasoning
recorded on `UserDoc.emailVerified`. Without it, anyone could claim a colleague's pending
invite by typing their address at signup. This is a real unauthorised-disclosure control.
_(Art. 32(1)(b))_

### Share tokens are not guessable

24 cryptographically random bytes — [`apps/api/src/lib/tokens.ts:5`](apps/api/src/lib/tokens.ts:5).
_(Art. 32)_

### Deleting a note removes everything under it

`recursiveDelete` takes the subtasks and history subcollections with it —
[`apps/api/src/routes/notes.ts:352`](apps/api/src/routes/notes.ts:352). No orphaned history
rows pointing at a person. _(Art. 17(1))_

### Removing a member releases their assignments

Their notes fall back to unassigned, but only once they have genuinely lost all access —
[`apps/api/src/routes/members.ts:170`](apps/api/src/routes/members.ts:170). _(Art. 5(1)(c))_

### Browser locale is not used as an ongoing tracking signal

`Accept-Language` is read once, at provisioning, and never again — the reasoning is on
[`apps/api/src/lib/language.ts`](apps/api/src/lib/language.ts) and the property is
grep-verifiable. _(Art. 5(1)(c))_

### Rate limiting is keyed on identity, not IP

[`apps/api/src/app.ts:93`](apps/api/src/app.ts:93) keys on the authenticated user id and only
falls back to `request.ip` for unauthenticated requests, so no per-IP profile is built for
signed-in users. _(Art. 5(1)(c))_

### Secrets are not committed

`.env` and `.env.*` are ignored, `.env.example` carries no values
([`.gitignore`](.gitignore)). Service-account keys never enter git. _(Art. 32)_

---

## 4. Gaps — data subject rights

### GAP-01 — No way to delete an account or its data · **High** · Art. 17

No `DELETE /me`. An owner can now delete each of their boards (`board.delete`) and a member
can leave a shared one (`board.leave`), but nothing removes the account itself. A departing
employee's `users/{uid}` document, any board they did not delete, their `createdById` and `assigneeId`
references and their `history.actorId` entries persist forever. Firebase Auth holds a second
copy of the identity that is independent of Firestore.

**Plan.** `DELETE /me`, plus an admin-invocable equivalent for someone who has already lost
their login.

1. Decide erasure vs. anonymisation per reference (see §6 — this is a decision, not a
   detail). Recommended: hard-delete `users/{uid}`, the user's own board and its notes;
   **anonymise** `createdById` / `assigneeId` / `actorId` to `null` on boards belonging to
   other people, so a colleague's board does not lose its content.
2. Delete every `members` row for the user across all boards, and the matching
   `memberRoles` key — one transaction per board, per the existing invariant.
3. Call `admin.auth().deleteUser(uid)` so the Firebase Auth record goes too.
4. Do it in a single idempotent, resumable routine; `recursiveDelete` for subtrees,
   `BulkWriter` for the unbounded cross-board sweep, as `members.ts` already does.
5. Integration test against the emulator asserting **no** collection still references the uid.

### GAP-02 — No data export · **High** · Art. 15, 20

No export endpoint. A subject access request can only be answered today by someone reading
the Firestore console by hand, which does not scale and is error-prone.

**Plan.** `GET /me/export` returning JSON: the profile, every board the user owns or belongs
to, their notes and subtasks, their history events, and their membership rows. Reuse the DTO
mappers so the export cannot drift from the API's own view. Machine-readable and structured
satisfies Art. 20; a ZIP is unnecessary at this data volume.

### GAP-03 — No privacy notice · **High** · Art. 13

Zero privacy, Datenschutz or GDPR text anywhere in the product or `docs/` (verified by grep
across the repo, excluding tooling). Users are told nothing about what is stored, for how
long, or on what basis.

**Plan.** The text is the controller's to write (§8). The code side is: a route and a link in
the account menu, in **both DE and EN** per [`docs/SPEC.md`](docs/SPEC.md) §12, and a link on
the sign-in screen — which is the one surface an unauthenticated person sees. Must state the
member-visibility disclosure from §2.

---

## 5. Gaps — data lifecycle and security

### GAP-04 — No retention policy anywhere · **High** · Art. 5(1)(e)

Nothing in Wally ever expires. Completed notes, history events, membership rows and user
profiles accumulate indefinitely. Storage limitation is not optional, and "we never delete"
is the clearest possible failure of it.

**Plan.** Agree a retention period per category with the controller (§8), then enforce it in
code rather than documenting an intention. Suggested starting point: completed notes 24
months after `completedAt`; history events 12 months after `occurredAt`; PENDING invites 90
days after `invitedAt` (GAP-07); user profiles deleted on offboarding (GAP-01). A scheduled
Cloud Run job is the natural home — there is no scheduler in the stack yet, so this gap
carries infrastructure work, not just a query.

### GAP-05 — Request logs contain IP addresses, unredacted and unbounded · **Medium** · Art. 5(1)(c), (e)

[`apps/api/src/app.ts:38`](apps/api/src/app.ts:38) enables Fastify's logger with no `redact`
configuration, so the default serializers write `remoteAddress` — a personal datum — into
Cloud Logging, which keeps `_Default` entries for 30 days unless the bucket says otherwise.
Authorization headers are not logged by default, but nothing in the config guarantees that
as the log grows.

**Plan.** Add an explicit `redact` list (`req.headers.authorization`, `req.headers.cookie`,
`req.remoteAddress`, `req.remotePort`). Confirm the Cloud Logging retention on the project and
state it in `DEPLOY.md`. Keep IP logging only if there is a stated security purpose, and then
say so in the privacy notice.

### GAP-06 — Share links never expire and are not auditable · **Medium** · Art. 5(1)(e), 32

`ShareLinkDoc` has no expiry field and no usage record
([`apps/api/src/lib/db/types.ts`](apps/api/src/lib/db/types.ts)). A link handed out once grants
access until someone remembers to revoke it, and nobody can tell who redeemed it. The token
itself is strong; the lifecycle around it is not.

**Plan.** Add `expiresAt` (default 30 days, enforced at redemption, surfaced in the UI) and
`lastRedeemedAt`. Do not log the token value itself.

### GAP-07 — Emails of people who never signed up are kept indefinitely · **Medium** · Art. 5(1)(e), 14

`MemberDoc.invitedEmail` stores the address of an invited non-user. That person has no
account, no way to exercise their rights, and — because the data was not collected from them
— is owed an Art. 14 notice Wally has no channel to deliver.

**Plan.** Expire PENDING invites (see GAP-04) so the address does not outlive the invitation.
Include the invitation's purpose and retention in the invitation email itself, which is the
only channel that reaches a non-user. Confirm with the controller whether inviting external
addresses is permitted at all.

### GAP-08 — Note history is per-person activity data · **Medium** · Art. 5(1)(b) · **and see §8**

Every history event records `actorId` and `occurredAt`
([`apps/api/src/routes/notes.ts:175`](apps/api/src/routes/notes.ts:175) and
[`:259`](apps/api/src/routes/notes.ts:259)). Only `CREATED` and `MOVED` exist today
([`packages/shared/src/enums.ts:77`](packages/shared/src/enums.ts:77)), so the trail is
narrow — but it is still a timestamped record of who did what, retained forever, and
[`docs/SPEC.md`](docs/SPEC.md) §10 justifies it only as "informational".

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
this sentence is the record of that decision. See §9.

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

| #     | Item                             | Gap            | Depends on        |
| ----- | -------------------------------- | -------------- | ----------------- |
| 1     | Answer the four decisions        | —              | §6                |
| 2     | Log redaction                    | GAP-05         | —                 |
| 3     | Data export endpoint             | GAP-02         | —                 |
| 4     | Account deletion                 | GAP-01         | 1                 |
| 5     | Share-link expiry                | GAP-06         | —                 |
| 6     | Retention job + invite expiry    | GAP-04, GAP-07 | 1, scheduler      |
| 7     | Privacy notice route, DE + EN    | GAP-03         | controller's text |
| 8     | History purpose in spec + notice | GAP-08         | —                 |
| ~~9~~ | ~~Seed data cleanup~~ — **done** | GAP-10         | —                 |
| 10    | TOM register                     | GAP-09         | —                 |

Items 2, 3 and 5 have no external dependency and can start immediately. Item 2 is the
smallest and is a sensible first cut. Item 9 is done.

> The API integration tests run against the Firestore emulator and were not run for the §9
> cleanup — the working tree currently also carries unrelated in-flight CI and tooling
> changes, so a full `make test` should be run once that settles.

### Checklist

- [ ] GAP-01 Account deletion (Art. 17)
- [ ] GAP-02 Data export (Art. 15, 20)
- [ ] GAP-03 Privacy notice (Art. 13)
- [ ] GAP-04 Retention policy (Art. 5(1)(e))
- [ ] GAP-05 Log redaction (Art. 5(1)(c))
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
side project exactly as it does to a company — Art. 28 has no size threshold.

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

The controller writes it; engineering ships it (GAP-03). Must cover the member-visibility
disclosure in §2 and the retention periods from GAP-04.

### ORG-05 — Do we need a DPIA? · Art. 35

Almost certainly not, now that the employee-monitoring reading is off the table (ORG-03):
small scale, no special-category data by design, no automated decision-making, no
systematic monitoring of a public area. Write the _assessment_ down anyway — a documented
"no" is compliant, silence is not, and it is three sentences.

### ORG-06 — Breach procedure · Art. 33, 34

72 hours to notify the supervisory authority. There is no CI pipeline and deployment is
manual ([`README.md`](README.md)), so it is worth writing down who notices an incident, who
decides, and who reports.

### ORG-07 — Add Wally to the record of processing · Art. 30

§2 is the inventory. It needs to land in the controller's central register, not only here.
---

## 9. Unrelated-company references — removed

Wally is a standalone project run by Luminull. It is **not** part of, and must not be
presented as part of, any other company's product. The repository had inherited references
to an unrelated company from the material this project was started from; **all 170 of them,
across 25 files, have been removed.** This section is the record of what was touched, so
the change is reviewable and the mistake is not repeated.

What was changed:

| Area                                                                                                                                                                                                                                                                               | What changed                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`README.md:3`](README.md:3)                                                                                                                                                                                                                                                       | Dropped "built for …" from the opening sentence                                                                                                                                                                                                                             |
| [`docs/SPEC.md:103`](docs/SPEC.md:103)                                                                                                                                                                                                                                             | The superseded-design note now says "a surrounding host platform"                                                                                                                                                                                                           |
| [`docs/SPEC.md`](docs/SPEC.md) §13                                                                                                                                                                                                                                                 | Was "Platform Integration", requiring integration with that company's platform. Rewritten as **§13 Identity**: Wally is standalone, users and authentication come from Firebase Authentication, permissions are Wally's own. The heading was kept so §14 does not renumber. |
| [`packages/shared/src/enums.ts:32`](packages/shared/src/enums.ts:32), [`ColorSwatchPicker.tsx:16`](apps/web/src/features/board/NoteDetail/ColorSwatchPicker.tsx:16), [`tailwind.config.ts:4`](apps/web/tailwind.config.ts:4), [`globals.css:6`](apps/web/src/styles/globals.css:6) | Design-token attributions reworded to "the design system". The apricot rationale — functional accents only, never decoration — is preserved verbatim; only the company name went.                                                                                           |
| [`apps/web/src/i18n/de.ts`](apps/web/src/i18n/de.ts), [`en.ts`](apps/web/src/i18n/en.ts)                                                                                                                                                                                           | **User-visible.** The invite field's placeholder read `name@<company>.de` in both catalogues; now `name@example.com`.                                                                                                                                                       |
| [`apps/api/src/seed.ts`](apps/api/src/seed.ts)                                                                                                                                                                                                                                     | Four seeded people replaced with invented names on `@example.com` — see GAP-10                                                                                                                                                                                              |
| 14 test files across api and web                                                                                                                                                                                                                                                   | Every fixture, mock and assertion address moved to `@example.com`, preserving the deliberate case variations that exercise email normalisation (`INVITEE@EXAMPLE.COM`, `INVITEE@Example.com`)                                                                               |
| [`apps/web/e2e/README.md`](apps/web/e2e/README.md), [`share.spec.ts`](apps/web/e2e/share.spec.ts)                                                                                                                                                                                  | E2E account placeholder and the generated invite address                                                                                                                                                                                                                    |

Verified after the change: `grep -ri` over the working tree returns nothing, all 106 web
unit tests pass, and all three packages typecheck clean. The API integration suite needs the
Firestore emulator and has not been run — see the note under §7.

**Two follow-ups this leaves open.** The e2e address in `README.md` is a placeholder for a
real Firebase sign-in account; whoever holds that account has to reissue it under the new
address before `make e2e` proves anything. And git history still contains every original
reference — rewriting it was judged disproportionate (GAP-10), so the history is not clean
even though the working tree is.
