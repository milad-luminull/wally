# Account controls release record

Status: implementation in progress; **not activated or deployed**. This record extends the
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

- Final cleanup race/data coverage review, final regression suites, CI on the candidate.
- Owner approval of notice, legal bases, retention, provider contracts and transfer safeguards.
- Fresh identity inventory and exact-subject verification of every existing account.
- Working-inbox password recovery test, with owner-entered passwords.
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
