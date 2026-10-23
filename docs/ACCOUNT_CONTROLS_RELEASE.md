# Account controls release record

Status: implementation in progress; **not activated or deployed**. This record extends the
approved single Auth0 + full MCP release, not a separate read-only rollout.

## Implemented interfaces

- `GET /me/export`: authenticated JSON attachment, version 1, `Cache-Control: no-store`.
  Uses current board/card DTO queries, so other people's private cards and share-link
  secrets are excluded. Explicit projections cover identity mappings, MCP connections,
  request/write counters, own audit events and command metadata. No export is stored.
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
owned-board responses are cleared while receipt fingerprints remain to prevent replayed
writes. Failed provider deletion leaves a pending job. A second sweep follows a two-minute
in-flight request drain interval. Minimal hashed denial records currently have no TTL;
verify the retention policy before production activation.

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
