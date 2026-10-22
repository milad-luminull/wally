# Auth0 and MCP production readiness

> **2026-10-22 model update:** The owner approved account-wide MCP access based on
> current Wally membership and roles. New OAuth connections require no board selection
> or owner AI switch. This is the first release: the earlier experimental connection
> model has been removed, with no migration or upgrade flow. See [the current connection model](MCP_CONNECTION_MODEL.md). Older selected-board validation below
> records historical behavior and is not the setup procedure for new connections.

Audit: 2026-10-21. Candidate: `202311734a65b2833f9fb970f865f1fca8d6cbec`, draft PR #66.

## Decision

Local implementation and the latest PR CI are validated. Production activation is not
ready for approval yet. Merging does not activate Auth0 or MCP: release runs on a `v*`
tag and requires green CI on the exact main commit plus production environment approval.
No merge, tag, deployment, provider switch, account migration or production write was
performed in this audit. Keep the existing local services and manual consent active.

## Evidence checked

- [CI run 39611374106](https://github.com/milad-luminull/wally/actions/runs/39611374106):
  all checks succeeded at the candidate SHA; PR remains draft/open.
- Release workflow validates flag dependencies, captures the previous serving revision
  and Hosting version, prepares the API without traffic, checks the web bundle, then
  switches traffic and publishes Hosting. Failure handlers restore prior API traffic
  and Hosting when their respective conditions apply. This is code review, not a
  demonstrated production rollback exercise.
- GitHub production environment has a required reviewer and a `v*` tag policy.
- Repository rollout variables AUTH0_ENABLED, AUTH0_SIGNUP_ENABLED, MCP_ENABLED,
  MCP_WRITES_ENABLED, MCP_CLIENT_ID and VITE_AUTH_PROVIDER were absent. Workflow
  fallbacks select Firebase and disable the new switches. The production environment
  also had no Auth0/MCP/provider overrides. Live runtime settings still require checking;
  release variables alone do not establish the currently serving production state.
- Public production `/health` returned HTTP 200. Protected-resource discovery at
  `https://api.wally.luminull.com/.well-known/oauth-protected-resource/mcp` returned
  HTTP 401 with UNAUTHORIZED / Missing bearer token. This is not usable public MCP
  discovery. It does not establish which revision or authentication mode is serving.
- Live Cloud Run revision/configuration inspection could not complete because the
  local Google Cloud credentials require reauthentication.

## Completed validation and its limits

See [local validation](MCP_LOCAL_VALIDATION.md),
[response investigation](MCP_RESPONSE_INVESTIGATION.md) and [card UI](MCP_CARD_UI.md).
Automated API/web tests, synthetic protocol tests, real Auth0 local MCP tests and actual
ChatGPT checks are separate evidence. Historical synthetic Inspector authentication
must not be represented as real OAuth verification.

The user confirmed a successful dummy-card creation. Card and compact-list UI rendered
in ChatGPT against synthetic local boards. The widget check had host CSP enforcement off;
repeat with enforcement on before publication. The earlier response-loading failure
also affected a no-tool conversation and loaded in a separate browser session; it is
not evidence of an MCP execution defect or a proven server-side fix.

## Outstanding activation gates

- [x] Reauthenticate Google Cloud; record the serving Cloud Run revision/image, traffic,
      runtime flags and Hosting version. Check production environment variable overrides.
- [ ] Freshly verify Auth0 tenant/client/API configuration, allowed production origins and
      callbacks, scopes, PKCE, issuer/audiences and Free-plan capabilities beyond trial.
- [ ] Reconcile current production account mappings using read-only inventory first.
      The historical report says four Google identities remained unmapped; do not assume
      this count is current or link accounts by email. Preserve original stable Wally IDs.
- [ ] Verify genuine mailbox recovery, HTTPS session restoration and Firebase rollback.
      The two CI accounts have no inboxes and do not prove password-email delivery.
- [ ] Close the Auth0/MCP erasure, export and retention release gates documented in
      GDPR.md, including authIdentities, mcpConnections, write limits
      and audit records. Obtain the required privacy notice/provider review.
- [x] Complete the RFC-required security review for the full authentication/MCP boundary.
      The focused card-widget review is not a substitute for this review.
- [ ] Verify the card and compact-list UI in ChatGPT with CSP enforcement enabled.
- [ ] Record a recoverable prior API revision and Hosting version and validate the paired
      rollback procedure. Keep Firebase accounts and verifier available.

## Staged release sequence after gates and explicit authorization

1. Finalize PR review and merge; wait for CI on the resulting main SHA. A green PR run
   does not satisfy the release workflow's separate main-SHA check.
2. Deploy an explicitly approved release tag with new features disabled if code delivery
   is desired before activation. Recheck effective environment variables first.
3. Activate Auth0 web login in a separate approved release:
   AUTH0_ENABLED=true, VITE_AUTH_PROVIDER=auth0, validated VITE_AUTH0_CLIENT_ID;
   keep MCP_ENABLED=false and MCP_WRITES_ENABLED=false. Keep signup disabled unless
   separately accepted. Verify login/logout, identity continuity and recovery.
4. Enable read-only MCP in a subsequent approved release: AUTH0_ENABLED=true,
   MCP_ENABLED=true, validated MCP_CLIENT_ID, MCP_WRITES_ENABLED=false.
   The built-in assistant switch is independent of MCP. Use the
   permanent endpoint `https://api.wally.luminull.com/mcp`, not the temporary tunnel.
   Verify public discovery, real OAuth, current-membership reads and denied access with
   designated acceptance fixtures. Verify revocation on a separate test connection.
5. Enable bounded writes only after explicit acceptance: MCP_WRITES_ENABLED=true.
   Validate revisions, operation replay without duplication and denial using approved
   disposable fixtures. Never use normal user content as a test target.

Production smoke checks are read-only by default. Any future production acceptance
fixtures or writes need explicit authorization. Do not revoke the owner's local manual
test connection or stop its tunnel as cleanup.

## Readiness follow-up — 2026-10-22

The account-wide connection implementation plan is complete. Production activation
remains gated by the unchecked items above; the October 21 audit is historical evidence,
not a current production-state assertion.

At `28fb4e7d`, lint/format, typecheck/build and full-stack browser CI passed. The unit
job failed because the brand guard rejected the explicitly approved connection status
lights. Commit `1a1917f0` permits those two status tokens on the connection page and
documents the design exception. All 10 focused brand/connection tests passed locally;
the new CI run is [39818316642](https://github.com/milad-luminull/wally/actions/runs/39818316642).
Do not infer a green run from the earlier candidate's results.

Read-only production inspection was attempted again for `luminull-wally` in
`europe-west1`, confirmed from repository variables. Google Cloud credential refresh
failed with “Reauthentication failed”; the serving revision, traffic and runtime flags
remain unverified. The owner has been asked to renew CLI authentication. No runtime
settings, accounts, connections, deployment or production content were changed.

### Live inspection after renewed authentication

The credential block above was resolved during the same follow-up. Read-only inspection
confirmed:

- Project `luminull-wally`, region `europe-west1`, service `wally-api`.
- Serving revision `wally-api-rel-0dece50` receives 100% of traffic.
- The serving revision's resolved image is
  `europe-west1-docker.pkg.dev/luminull-wally/wally/wally-api@sha256:e9695aa5f6384bd91a2290a84c5c0eceff11345a5bacdf510b9bdbc600b36a70`.
  This is the immutable revision's reported image digest, not the service template image.
- `ASSISTANT_ENABLED=true`; Auth0/signup/MCP/write flags are absent from that revision.
  Absence is recorded rather than treated as proof about an uninspected image's defaults.
- GitHub production environment has no Auth0/signup/MCP/write/provider variable overrides.
- Hosting release `sites/luminull-wally/releases/1792443034085000`, released
  `2026-10-19T20:50:34.085Z`, uses version
  `sites/luminull-wally/versions/308db1a2383aeaa3`.

This captures the current API/Hosting pair for rollback planning. It does not prove a
rollback exercise or close the remaining identity, Auth0 configuration, privacy,
security review, recovery and ChatGPT CSP acceptance gates. No deployment was performed.

### Security and identity follow-up

Independent source review at `71b9f516` covered JWT/identity resolution, REST/MCP auth
boundaries, connection transactions, permissions/private notes, command replay,
widgets, web sessions, migration and release configuration. No confirmed auth or
permission bypass was found. One availability issue was identified: MCP bypassed the
application request limiter and only writes had a shared budget. The fix adds a shared
300/minute authenticated request budget before tool execution, preserving the separate
write budget. A regression first failed (200 instead of 429), then passed; all 20 MCP
transport tests and the full 699-test API suite (66 files, one worker) passed. API
typecheck and focused lint passed. This is a source review, not security certification.

A fresh read-only Firebase/Firestore inventory found nine Firebase accounts, seven
Wally users and two stored identity mappings. No mapping targeted a missing Wally user.
Among source identities with an existing Wally record and no disabled/duplicate-email
exclusion, six Google identities were found: one exact subject/UID mapping and five
without a matching mapping. One password identity has its expected deterministic
mapping. Two Firebase accounts were excluded from this comparison. These are source
and mapping counts, not verification that the remaining subjects exist in Auth0 or are
migration-ready. The historical four-unmapped count must not be used for cutover.
No account identities or emails are included in this report, and no mapping was written.

Privacy inspection confirms the existing GAP-01/02/03/04 work is still open: account
erasure, export, notice and retention need implementation/owner decisions, not a checkbox
change. The new bounded request counter is included in the GDPR data inventory. Do not
expire revoked-connection tombstones in isolation: deleting the last history can allow
an old still-valid OAuth connection to auto-establish again.

ChatGPT's “Enforce CSP for custom apps” setting was enabled and its checked state
verified. Historical card/list widgets could not reopen. A fresh read-only call through
the installed local connector failed at the OpenAI tunnel probe with HTTP 429, before a
successful Wally response. Thus CSP rendering acceptance remains open; this is not
evidence of a Wally serialization or CSP defect. The manual Wally connection was not
revoked, no tunnel was rotated, and no notes were changed.

Auth0 dashboard readback confirms the configured MCP client is a third-party SPA with
only the ChatGPT callback and approved localhost Inspector callback. Authorization Code
and Refresh Token grants are checked; Client Credentials is disabled. Refresh rotation
is enabled, idle lifetime 604800 seconds, maximum 2592000 seconds, overlap zero.
The MCP API shows two of two user-delegated permissions granted, no client access and
zero anonymous permissions. Public issuer discovery returns `https://login.luminull.com/`
and advertises S256. This alone does not prove per-client PKCE enforcement. The dashboard
still reports 19 trial days remaining. Current [Auth0 pricing](https://auth0.com/pricing)
lists a custom domain with credit-card verification; tenant billing/entitlements beyond
the trial still require confirmation. No Auth0 settings or grants were modified.

Wally Web dashboard readback also confirms production/local callback and logout URLs
(`https://wally.luminull.com/login`, `http://localhost:5174/login`) and matching web
origins. Its refresh rotation is enabled with seven-day idle and thirty-day maximum
lifetimes. Auth0's current user list shows the two documented password test fixtures
and the owner's Google identity; this does not provide ready verified subjects for the
five remaining source Google identities. The recovery test is awaiting an owner-controlled
real inbox and explicit permission to send one reset email; no password was requested.

The owner subsequently confirmed neither password test account has an inbox; only the
owner's Google account has a working inbox. No reset was sent. Testing Auth0 password
recovery would require a separately authorized disposable password identity with a real
inbox; Google recovery is not an equivalent test.

Auth0 Teams subscription readback shows the current plan is Free ($0), with 25,000
users and 1,000 M2M tokens. Its feature table marks social/database connections,
custom domains and a custom email provider Included, while email workflow, custom
page templates and several enterprise/session APIs are Trial. This verifies the basic
Free-plan premise, but does not demonstrate every enabled tenant feature after expiry.
No billing or subscription setting was changed.
