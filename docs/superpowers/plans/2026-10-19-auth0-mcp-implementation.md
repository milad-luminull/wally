# Auth0 and MCP implementation continuation

**Spec:** [rollout](../../rfcs/AUTH0_MCP_ROLLOUT.md), [MCP contract](../../rfcs/WALLY_MCP.md).

The owner authorized implementation and asked to continue through the rollout rather than
stop after a foundation. Work now stays in the isolated `wally-auth0-mcp` worktree, preserving the original checkout.
Use test-driven development and review security boundaries before enabling production.

## Requirements and tasks

- [x] Web authentication: neutral Wally identity context; Auth0 Authorization Code + PKCE
      using the maintained SPA SDK; tokens in memory; safe callback return paths; API-derived
      stable user ID; session/cache isolation, refresh, logout and useful recovery errors.
      Preserve Firebase as an explicit deployment rollback mode.
- [x] Controlled migration tooling: export only required Firebase identity metadata; deterministic
      import plan tied to source UID; Auth0 password reset for existing password users;
      verified Google subject continuity; dry-run, conflict detection and resumable apply.
      No email-only linking and no user reset messages without an explicit execution decision.
- [ ] Tenant setup: inspect existing Auth0 configuration; prepare SPA origins/callbacks,
      REST/MCP audiences and signed claim Action. Keep secrets out of source and output.
- [x] API custom domain: replace release drift check with expected domain/service mapping
      plus HTTPS health/CORS checks; production frontend uses `https://api.wally.luminull.com`.
- [x] MCP access policy: owner must explicitly enable external AI access for a shared
      board (owner decision). Per-user connection grants restrict selected boards and scopes;
      durable revocation is checked on every call, including retries.
- [x] MCP read adapter: single `/mcp`, public protected-resource discovery, exact MCP
      audience, no REST-token substitution; five read tools, private-data filtering and
      bounded traversal beyond 100 notes; ChatGPT is the first compatibility target.
- [x] MCP writes: explicit write consent, eight approved operations, shared commands,
      caller-stable operation IDs and revisions, connection-bound receipts/audit, kill
      switches and rate limits. No destructive/admin tools.
- [ ] Verification: tests, typecheck/lint, affected UI, Inspector and real-host checks;
      security review; deployment/privacy/rollback documentation and exact pending blockers.

## Current progress

### Isolated release candidate (2026-10-20)

Auth0/MCP changes were copied into the managed `wally-auth0-mcp` worktree from the
current HEAD, excluding the unrelated board-navigation/sharing redesign and research.
Mixed account-menu and translation files contain only the auth/connection additions.
Both isolated builds and typechecks passed; API tests passed 60 files / 645 tests,
and web tests passed 95 files / 788 tests.

CI keeps Firebase as the default. A new `auth0-validation` PR label provides a
maintainer-controlled opt-in for real hosted-login tests without changing production
or the repository-wide provider. The owner approved the label on draft PR #66 and it is applied. Automatic approval
review rejected an always-on Auth0 CI matrix before real-login validation; that change
was not applied. The isolated PR-scoped opt-in preserves the existing activation gate.

### Main integration (2026-10-20)

Merged main 0dece50c into the isolated candidate, preserving its error handling,
session-expiry messages and assistant model defaults. Auth0 session expiry now
exposes the same signed-out notice and explicit logout clears it. API build/typecheck
and all 678 tests passed; web build/typecheck and all 845 tests passed. Formatting,
web lint (warnings only) and 30 domain/Action script tests passed. One hosted-login
test expectation was updated to the clearer verification error copy from main.

### Hosted-login validation (2026-10-20)

GitHub run 39403192298 passed all checks at fbfb30b5: 22 browser tests executed,
zero skipped; 21 passed immediately and the mobile test passed on retry. Real
password login, board continuity, profile save/reload and return navigation passed.
CI now uses the existing HTTPS app/API hostnames mapped only to loopback in its
runner, with a temporary CA trusted by the system, browser and Node. Public DNS,
Auth0 settings and production services are unchanged. Tokens remain memory-only.
The mobile retry came from a substring selector matching board/note buttons;
it now selects the exact desktop Wand control. Final rerun is pending.
MCP real-host validation and production cutover remain pending.

### CI account continuation (2026-10-20)

- [x] Apply the owner-approved Google mapping after fresh Firebase/Auth0 checks;
      read back the original Wally ID; revoke verifier access and remove credential files.
- [x] Verify local logout returns to the signed-out login page.
- [x] Preserve the Firebase CI path while adding an explicit Auth0 test mode.
- [x] Bind the configured Auth0 database test subject to the seeded owner only in
      emulator project `wally-e2e`; reject other projects and missing emulator configuration.
- [x] Exercise hosted email/password login through the shared Playwright helper and
      retain strict token verification in the API.
- [x] Verify the Auth0 CI account with its owner-set password, then run the affected E2E
      flows before enabling Auth0 in CI or production.

The owner confirmed both legacy password test accounts have no inbox and are disposable
CI fixtures. No reset email will be sent. The imported account can be reused with an
administrator-set test password; credential entry is handed to the owner. This is test
account provisioning, not evidence that email-based password recovery works.
The Google owner mapping succeeded on 2026-10-20. The private
`google-owner-preapply-verification` and `google-owner-mapping-result` records contain
the fresh checks and apply result. Readback preserved the original ID. Verifier grant
revocation was confirmed at zero client-access permissions; temporary secret files
were removed. Four other Google subjects remain unmapped.

CI changes add an opt-in hosted-login helper, provider-specific credentials, fail-closed
fixture seeding and disabled traces. The full API suite passed 60 files / 645 tests,
including six fixture safety tests. Playwright discovery loads all 19 tests; this is
not an executed browser test result. The changed helpers pass TypeScript and ESLint.
An independent scoped review found no actionable defects. The real password/consent
flow and reload-dependent E2E cases remain pending. The owner confirmed the test
password was changed on 2026-10-20. The three non-secret GitHub variables
`VITE_AUTH0_CLIENT_ID`, `E2E_AUTH0_EMAIL` and `E2E_AUTH0_SUBJECT` are saved and read back.
`E2E_AUTH0_USER_PASSWORD` was confirmed present in Actions secrets after the owner's
2026-10-20 update; the existing Firebase secrets are unchanged
and `E2E_AUTH_PROVIDER` remains unset (Firebase default). The browser's GitHub session
uses a different account without repository settings access; the authenticated local
GitHub CLI can configure this repository.

The owner clarified that the second dummy user serves Dependabot. CI now selects separate
bot email/subject variables without falling back to the ordinary CI account. The owner
created the second Auth0 database test user and saved its password in Dependabot's
`E2E_AUTH0_USER_PASSWORD` secret on 2026-10-20. Both secret names were verified in their
respective stores. The observed bot subject was saved as
`E2E_AUTH0_DEPENDABOT_SUBJECT`; its email variable is configured separately.
With explicit owner approval, both dummy accounts were marked email-verified in Auth0
and the saved VERIFIED status was observed. This is synthetic fixture provisioning,
not evidence of mailbox ownership or password-recovery delivery. No password
was retrieved from GitHub (stored secret values are not readable).

Local implementation includes opt-in new-account signup, hosted login, connection settings,
owner controls, five reads/eight writes, durable grants and bounded write counters. The
command transaction rechecks grant and owner policy for new writes and receipt replay.
Terminal refresh errors clear the authenticated UI; transient network failures retain it.

Verification on 2026-10-19: clean full API run 639 tests; web run 790 tests; production web
build and API typecheck pass. A later terminal-refresh recovery fix has 23 focused tests
plus web typecheck/lint. Official Inspector 2.11.0 against a unique local emulator project
negotiated 2025-11-25, discovered all 13 tools, read/created/completed a note, replayed once,
then rejected replay after revocation. Strict schema check: no errors, two nullable-type
portability warnings. This is not real ChatGPT/tenant verification. Code review fixed
named-database migration selection, certificate project validation and session recovery.

Auth0 web SPA, REST/MCP resources and scopes are configured. Wally Web API access and
rotating refresh access were approved by the owner. ChatGPT CIMD import succeeded, but
Auth0 documents its selected private-key method as Enterprise-only; its MCP grant was
revoked and it must not be used for the Free-tier rollout. The replacement third-party
public client `Wally ChatGPT (PKCE)` (`tpc_oR2NUn5BAcms9r5Z5MhHVf`) now has the
owner-approved MCP read/write grant and rotating refresh sessions (7-day idle/30-day max).
The owner saved Google OAuth credentials; after refresh, the development-key warning
disappeared. The custom-domain authorization flow reaches Google's account chooser with
`https://login.luminull.com/login/callback`. Token exchange and account login remain
unverified. The dashboard's Try Connection uses the default tenant domain and returns
a redirect mismatch; it is not the production custom-domain flow.
Both login providers were promoted to domain level with explicit owner approval and
verified enabled for the replacement ChatGPT client.

Read-only production counts: eight Firebase accounts, six Wally records, no duplicate
source emails. After explicit owner approval, the private Docker export was created at
`/tmp/wally-auth0-production-review` (directory 0700, files 0600): one password-reset
import user, five Google mappings, and two accounts quarantined for missing Wally records.
The owner-approved one-account Auth0 import completed on 2026-10-19: one inserted,
zero updated, zero failed, with upsert and completion emails disabled. Its job result
is saved privately alongside the export. On 2026-10-20, the explicitly approved password
identity mapping was applied after another live CLI verification. Production readback
confirmed the exact original Wally ID. No reset emails, production login switches or
deployment have been performed. Google identities were unmapped at that stage; the
owner's subsequent mapping is recorded in the CI continuation above.

On 2026-10-20, a read-only production re-export using named database `wally` matched
the original plan and import file exactly. It is stored under the private review
directory's `recheck-20261020` subdirectory. No `AUTH0_MIGRATION_TOKEN` is configured;
The owner subsequently approved a dedicated `Wally migration verifier` client with
only `read:users`. Its exact-subject check found one verified imported password identity
and five Google subjects not yet created in Auth0. The password-only CLI dry run passed
source freshness and identity metadata checks; no mappings were written. Detailed
results remain in the private review directory. Google users must complete their first
Auth0 sign-in before their identities can be verified.
The verifier's Management API client grant was revoked after these checks, and local
credential/token copies were removed. The issued token had a 24-hour lifetime;
grant revocation prevents new issuance, not invalidation of an already issued token.
The verifier application remains registered without a Management API client grant.
For the approved mapping, its read-only grant was temporarily restored and revoked
again after successful apply/readback. The second token existed only in process memory;
temporary client-secret files were removed. Private mapping results are recorded as
`password-preapply-verification` and `password-mapping-result` in the review directory.

Local real-login test: `wally-auth0-api-review` uses emulator project
`wally-auth0-review`, loopback port 4501, Auth0 enabled, and signup/MCP/assistant
disabled. The existing API container and its private migration evidence are retained.
The local web container uses the temporary override
`/private/tmp/wally-auth0-web-review.yml` and localhost:5174 callback. It has reached
Google's account chooser through the actual SPA PKCE flow, awaiting the owner's
sign-in. Restore the ordinary local web config with
`docker compose up -d --no-deps web` after testing. Do not recreate the original API
container while its private `/tmp` migration records are still needed.

The owner completed Google sign-in on 2026-10-20. The Google provider subject observed
in Auth0 matched the reviewed Firebase subject. An emulator-only mapping and synthetic
board allowed the actual SPA callback, token exchange, `/me`, board/member/note reads
and preference update to succeed under the original Wally ID. Production Google mapping
subsequently passed the approved fresh CLI verification and readback described above.
Page reload in localhost testing waits for silent authentication and returns to login;
interactive redirect requires consent again and succeeds. Do not count session
restoration or rotating-refresh validation as passed from this test. Confirm on the
production HTTPS origin before cutover; do not weaken tenant consent protections.
The owner confirmed the imported password account has no inbox and exists for CI.
No reset email will be sent there; administrator test-password setup is pending.

The signed profile Action is deployed and attached to Post Login; the flow reports all
changes live.

Remaining: verify Free-compatible client authentication; authorized migration
review/import/recovery; actual Google login/token exchange, refresh/logout and
ChatGPT read/write escalation; privacy/erasure operational gates; coordinated deployment
and rollback verification. Do not mark the rollout complete from local test success.
