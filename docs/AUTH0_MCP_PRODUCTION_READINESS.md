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

- [ ] Reauthenticate Google Cloud; record the serving Cloud Run revision/image, traffic,
      runtime flags and Hosting version. Check production environment variable overrides.
- [ ] Freshly verify Auth0 tenant/client/API configuration, allowed production origins and
      callbacks, scopes, PKCE, issuer/audiences and Free-plan capabilities beyond trial.
- [ ] Reconcile current production account mappings using read-only inventory first.
      The historical report says four Google identities remained unmapped; do not assume
      this count is current or link accounts by email. Preserve original stable Wally IDs.
- [ ] Verify genuine mailbox recovery, HTTPS session restoration and Firebase rollback.
      The two CI accounts have no inboxes and do not prove password-email delivery.
- [ ] Close the Auth0/MCP erasure, export and retention release gates documented in
      GDPR.md, including authIdentities, mcpConnections, mcpBoardPolicies, write limits
      and audit records. Obtain the required privacy notice/provider review.
- [ ] Complete the RFC-required security review for the full authentication/MCP boundary.
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
4. Enable read-only MCP in a subsequent approved release: ASSISTANT_ENABLED=true,
   MCP_ENABLED=true, validated MCP_CLIENT_ID, MCP_WRITES_ENABLED=false. Use the
   permanent endpoint `https://api.wally.luminull.com/mcp`, not the temporary tunnel.
   Verify public discovery, real OAuth, selected-board reads and denied access with
   designated acceptance fixtures. Verify revocation on a separate test connection.
5. Enable bounded writes only after explicit acceptance: MCP_WRITES_ENABLED=true.
   Validate revisions, operation replay without duplication and denial using approved
   disposable fixtures. Never use normal user content as a test target.

Production smoke checks are read-only by default. Any future production acceptance
fixtures or writes need explicit authorization. Do not revoke the owner's local manual
test connection or stop its tunnel as cleanup.
