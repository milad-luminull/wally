# Account controls release record

Status: implementation and independent review complete; release acceptance in progress; **not activated or deployed**. This record extends the
approved single Auth0 + full MCP release, not a separate read-only rollout.

## Implemented interfaces

- `GET /me/export`: authenticated JSON attachment, version 1, `Cache-Control: no-store`.
  Uses current board/card DTO queries, so other people's private cards and share-link
  secrets are excluded. Explicit projections cover identity mappings, MCP connections,
  request/write counters, own audit events and command metadata. Personal assistant
  questions, conversation event metadata, approval/tidy decisions and daily usage are
  included. Generated prose/proposals without complete source provenance are explicitly
  redacted: a source note may since have become private or been removed. Opaque model
  messages and raw tool results are never exported. No export is stored.
- `GET /me/deletion`: names owned boards and reports whether recent authentication exists.
- `DELETE /me`, body `{"confirmation":"DELETE"}`: requires a verified primary login
  within five minutes. Returns 202/pending after durable job and denial records commit.
  This is not a declaration that provider cleanup is complete.
- `/settings/account`: English/German download, owned-board warning and typed confirmation.
- `/privacy`: English/German notice linked from sign-in and account settings; requires
  owner approval before activation.

Deletion jobs remove owned boards and contents, private cards elsewhere, memberships and
cached roles together, user subcollections, and exact mapped Auth0/Firebase identities.
Shared cards elsewhere survive with anonymized authorship/assignment/history. Cached
owned-board and deleted-private-note responses are cleared while receipt fingerprints
remain to prevent replayed writes. Assistant caches on boards containing deleted private
notes are removed because generated prose may contain those notes without explicit IDs. Failed provider deletion leaves a pending job. A second sweep follows a two-minute
in-flight request drain interval. Minimal hashed denial records currently have no TTL;
verify the retention policy before production activation. Completed cleanup jobs discard
board/note target IDs and receive a 30-day expiry; the release script enables TTL only for
that job collection. Pending jobs and denial markers receive no expiry.

The public API never receives Auth0 Management API credentials. A dedicated Cloud Run job
runs `node dist/account-maintenance.js --apply`, scheduled every five minutes. Deployment
wiring is in `scripts/deploy-account-cleanup.sh`; **cloud execution is not yet verified**.
Operator entry point: `pnpm --filter @wally/api account:maintenance --status` or
`--apply --user=EXACT_WALLY_ID`. Use only the intended environment/database. Status commands
are read-only; apply is destructive and must target an authorized deletion request.

## Required worker configuration before deployment

- Dedicated `wally-account-cleanup` service account: database access and Firebase user
  deletion permission, plus access to only the cleanup client secret.
- Dedicated `wally-account-scheduler` service account: invoke only the cleanup Cloud Run job.
- Auth0 Management API client with `delete:users`, verified tenant, secret stored in Secret
  Manager; no email-based lookup or linking. Confirm Free-plan M2M allowance. Tokens are
  requested only when there are pending jobs and reused within that worker execution.
- Release variables `AUTH0_MANAGEMENT_DOMAIN`, `AUTH0_CLEANUP_CLIENT_ID`, and
  `AUTH0_CLEANUP_SECRET_VERSION` (Secret Manager name:version, not its secret contents).
- Deploy the updated `infra/auth0-post-login.cjs` Action before enabling account deletion.
  The signed authentication-time claim comes from a completed primary authentication
  method, never the access-token issue time or a refresh exchange.

References: [Auth0 reauthentication](https://auth0.com/docs/authenticate/login/max-age-reauthentication)
and [post-login event](https://auth0.com/docs/actions/reference/post-login/post-login-event-object).
Actual password and Google reauthentication remain acceptance gates; synthetic claims
are not proof of live Auth0 behavior.

## Release gates still open

- CI on the latest release candidate (independent review and local regression suites passed).
- Owner approval of notice, legal bases, retention, provider contracts and transfer safeguards.
- Fresh identity inventory and exact-subject verification of every existing account.
- Real recent-authentication and provider-cleanup acceptance on disposable identities.
- Worker IAM, secret, schedule and retry/status verification.
- Merge and green CI on exact main; capture current API + Hosting rollback pair.
- Both MCP flags enabled together; permanent-endpoint ChatGPT reads/writes/retries/denial/
  revocation/widgets with CSP enforcement, disposable fixtures only.
- Production observation for 30 minutes and recorded final versions/evidence.

## Review follow-up, 2026-10-23

The independent review identified late assistant persistence after board-owner deletion,
missing personal assistant export data, nested assignee proposals that survived erasure,
and cached copies of deleted private cards. The fixes fence assistant persistence against
live board/owner/membership and source-note state transactionally, record private cleanup
targets before deletion, clear the affected caches and anonymize nested proposals.
Regression tests include paused capture/tidy requests resumed after cleanup completes.

Candidate e08a8394 passed unit/integration, lint and type/build CI. Its browser job timed
out fetching Ubuntu Playwright system dependencies before the stack or browser suite ran.
This was infrastructure failure, not passing browser acceptance. The updated candidate
must run the entire CI gate again. No production settings or data were changed.

Fix-pass validation: full API suite **717/717 passed** across 70 files; API typecheck,
lint, formatting and deployment-shell syntax passed. The unchanged web implementation
retains its prior **854/854** test result. These are local automated tests; real provider
cleanup, password recovery, production OAuth/widgets and post-deployment observation
remain separate acceptance gates.

## Recovery acceptance and CI status, 2026-10-23

The owner-created, separate password-test identity received the reset email. The owner
reset its password; Auth0 History independently recorded a successful password change.
The owner then confirmed consent followed by Wally login with the new password, and
confirmed that reopening the used reset link displayed **Invalid Link**. No passwords or
reset links were recorded. The existing Google identity was unchanged.

The local stack still had signup disabled from migration-only testing. The exact verified
test subject was provisioned through the existing identity resolver in the isolated local
emulator, without restarting containers or disturbing ongoing sessions. The successful
recovery login is therefore **not live signup acceptance**. The compose profile now enables
signup on its next deliberate start.

Candidate `1a463ab205f45f0906ad05b059284aff979c87a0` passed the entire CI gate, including
browser tests ([run 39925954122](https://github.com/milad-luminull/wally/actions/runs/39925954122)).
A subsequent compose-only candidate encountered another stalled Ubuntu mirror download.
Candidate `b2442104d171625304561f515aacde177dfc8c7c` changes that download source to Ubuntu's
standard archive, retaining package signature verification and the full browser gate.
Its CI result must be checked before merge. No production activation has occurred.

## Next-login migration, 2026-10-23

Following the owner’s correction, existing Google users do not need advance sign-in.
The operator exported and revalidated the current Firebase provider inventory, then
prepared all six Google-subject mappings. Five mappings were added; the owner’s existing
mapping was unchanged. Production readback confirmed six exact Google mappings, seven
total mappings and the original seven Wally users. Auth0 still requires each user’s
Google authentication at next login. No user outreach or email-based linking occurred.
The source Firebase identities and rollback path remain intact.

The privacy/deletion contact is now privacy@luminull.com in both languages; the owner
confirmed this mailbox receives mail. Candidate b2442104 passed full CI, including the
browser gate. The subsequent migration change passed 43 focused authentication/migration
tests, API typecheck and focused lint; its final candidate CI remains required.

## Cleanup infrastructure preparation, 2026-10-23

The owner approved the dedicated Auth0 cleanup client. Its client-credentials exchange
was verified to return exactly `delete:users`. The generated secret is stored as version
1 of `wally-auth0-account-cleanup` in Secret Manager (europe-west1); the secret-level
accessor binding names only the cleanup worker. No secret is stored in GitHub variables
or the public API. The temporary local secret copy was removed.

Dedicated worker and scheduler service accounts now exist. Worker Firestore access is
conditioned on database `wally`; its Firebase custom role has only `firebaseauth.users.delete`.
The deployer can attach these service accounts. Scheduled-job deployment uses a custom
create/get/update role. The release script binds invocation directly on the cleanup job;
it does not rely on unsupported project-level resource-name conditions for Cloud Run.
Cloud Scheduler and Secret Manager APIs are enabled. The job and schedule are not yet
deployed or exercised.

The reviewed `infra/auth0-post-login.cjs` Action was deployed; the dashboard reports it
up to date. Live recent-authentication acceptance is still required. Production serving
API/Hosting remain unchanged; enabling Auth0/MCP is still part of the single release.

CI on a671757a passed units, lint and build but stalled before browser tests. Live logs
showed an indirect `/etc/apt/apt-mirrors.txt` selection still using the Azure mirror.
The CI mirror replacement now covers both direct sources and mirror-list files; the
full browser gate remains required.

## Release execution, 2026-10-24

The owner accepted the recent-sign-in check and instructed release. This is owner
acceptance, not evidence of completed provider deletion: the disposable local account
has no cleanup job. Cloud worker execution and production fixture acceptance remain
separate checks.

PR #66 merged as `aefd229e66ef7da058a8ee566196536ced556979`. All main CI checks passed
([run 40116287130](https://github.com/milad-luminull/wally/actions/runs/40116287130)).
Fresh production readback confirmed six exact Google mappings, seven mappings total and
seven original Wally users. Production workflow variables enable Auth0/signup and full
MCP reads/writes together; assistant configuration was preserved.

The owner approved release `v0.8.1`. Its deployment stopped before any production
mutation because the runner lacked the Cloud SDK beta component required by the existing
canonical-domain guard. The follow-up explicitly installs that component through
`setup-gcloud`; the guard is retained. The failed tag is preserved, and the next candidate
must again pass exact-main CI before a new patch tag is released.

## Release repair: 25 October 2026 (not deployed)

The v0.8.2 retry passed the domain guard and created a no-traffic API candidate and
cleanup job, then failed at the job invocation IAM binding. Ordinary deployment now
requires bootstrap to have prepared a paused scheduler, job-level invocation binding,
and ACTIVE completed-job TTL. It must not grant IAM, create schedules or modify TTL.

Permission inventory (a configured role is not proof of successful operation):

| Actor / operation                              | Required access / resource                                                             | Evidence and recovery                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GitHub deployer: canonical domain              | run.domainmappings.get, project                                                        | Actual retry read passed; read-only                                                                                |
| GitHub deployer: API candidate / traffic       | run.services.create/update/get, revisions get/list, operations get; actAs on wally-api | Candidate deployment passed; traffic activation not executed; restore exact old revision                           |
| GitHub deployer: container publication         | Artifact Registry upload/download on wally repository                                  | Actual image push passed; immutable digest used                                                                    |
| GitHub deployer: database rules/indexes        | Firebase Rules release permissions; datastore.schemas.*, operations get/list           | Actual deployment passed; source rules/indexes unchanged from serving commit                                       |
| GitHub deployer: cleanup image/config          | run.jobs.get/update and operations get; actAs on wally-account-cleanup                 | Job creation passed; no execution acceptance yet; restore saved job config while paused                            |
| Operator bootstrap: invocation policy          | run.jobs.getIamPolicy/setIamPolicy on cleanup job                                      | Prior conditional deployer grant denied; exact evaluation unresolved; operator owns setup                          |
| Operator bootstrap: scheduler                  | cloudscheduler.jobs.list/get/create/update/pause; actAs on scheduler SA                | Not yet executed; initial target is GET, then verified paused before POST run target                               |
| GitHub deployer: scheduler activation/recovery | cloudscheduler.jobs.get/pause/enable (resume operation)                                | Must inspect actual permission names and evaluate before granting; existing custom role only has create/get/update |
| Operator bootstrap: completed-job TTL          | datastore.schemas.update plus operations read                                          | Existing Index Admin covers TTL; accountDeletionJobs TTL not yet enabled                                           |
| GitHub deployer: Hosting publish/recovery      | Firebase Hosting versions/releases create/get/list and upload                          | Existing hosting.admin grant; capture succeeded in workflow; no new publication yet                                |
| Cleanup worker: database                       | datastore.user, restricted to wally database                                           | Binding inspected; real worker execution unverified                                                                |
| Cleanup worker: Firebase identities            | firebaseauth.users.delete                                                              | Custom role present; only designated fixture can prove deletion                                                    |
| Cleanup worker: Auth0                          | secretmanager.versions.access on exact secret; M2M delete:users                        | Token scope verified earlier; no live provider deletion yet                                                        |
| Scheduler identity: cleanup invocation         | roles/run.invoker on exact cleanup job; Scheduler service agent token minting          | Direct invocation binding absent before bootstrap; no execution acceptance                                         |

The local Hosting lookup required `X-Goog-User-Project: luminull-wally`. With that
header, a fresh read confirms `sites/luminull-wally/versions/308db1a2383aeaa3`.
This fixes inspection only; it does not authorize or perform a publication.

Operator commands are implementation interfaces, not yet verified production steps:

- Prepare infrastructure: `GCP_PROJECT_ID=luminull-wally GCP_REGION=europe-west1 bash scripts/bootstrap-account-cleanup.sh --apply`.
- Inspect prerequisites: `node scripts/check-release-prerequisites.mjs release-state.json` with the release environment.
- Recover after interruption: download the matching `release-state-RUN-ATTEMPT` artifact, inspect its project/versions, then `node scripts/recover-release.mjs --apply release-state.json`.

Recovery restores API and Hosting, pauses the scheduler and restores worker configuration
only when no execution is active. It does not reverse a completed user-requested deletion.
An empty worker queue is not Auth0/Firebase provider acceptance. Paused scheduler state and
pending deletions require explicit operator inspection before resumption.

### Reviewed repair acceptance gate

Independent review found unsafe worker replacement after a failed scheduler pause,
non-idempotent pause handling, missing candidate config identity, and no enforced
worker-acceptance gate. Focused regressions reproduce the first, second and fourth
configuration-path failures; all are addressed in the repair branch.

Before release, `infra/account-cleanup-acceptance.json` must contain an honest,
reviewed record of actual designated-fixture checks. **No record has been created**;
the repaired workflow therefore currently refuses activation. The record must include
`version: 1`, `checkedAt` (within 24 hours), `sourceFingerprint`, exact immutable
`image`, `project`, `database`, `workerServiceAccount`, `secretVersion`,
`auth0ClientId`, `auth0ManagementDomain`, an `evidenceUrl` in this repository and
true verified results for `workerDatabaseAccess`, `workerSecretAccess`,
`auth0DeleteUsersScope`, `firebaseFixtureDeletion`, `auth0FixtureDeletion`, and
`idempotentRetry`. The record asserts independently inspected evidence; the schema
alone cannot prove the assertions are true. It must never be populated from mocked
tests or an empty queue.

The worker is pinned to that tested image. Its source fingerprint covers API/shared/
config trees, dependency manifests and Docker ignore rules, allowing workflow-only
changes without rebuilding an untested worker. This deliberately replaces the older
assumption that the worker must use a newly rebuilt API image: it uses the tested
image with matching worker source instead. Changed worker source/config invalidates
the evidence and requires new acceptance. Ordinary API release still uses its exact
candidate image and revision.

Candidate reuse now requires a matching full commit label and deployment-managed
configuration before any mutation. Legacy candidates without this proof fail closed;
new candidates receive `wally-commit` and their config hash is recorded. Recovery
leaves cleanup paused and never replaces a worker unless that pause was verified.

Remaining live prerequisites: actual fixture-backed worker acceptance; bootstrap;
read-only WIF preflight; exact-main CI; production OAuth/ChatGPT acceptance and
observation. The new tests do not replace these. Policy Troubleshooter is disabled
in this project, so the original conditional `setIamPolicy` denial remains unexplained;
no diagnostic API or IAM settings were changed as part of this implementation pass.
