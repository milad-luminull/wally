# Local Auth0 MCP validation

Status on 2026-10-20: the isolated Docker environment starts from the PR worktree,
public discovery and unauthenticated challenges work, and synthetic boards are seeded.
Inspector 2.11.0 completed discovery and reached the real Auth0 / Google account chooser.
**Real Auth0 code exchange, read-only MCP tools, board consent and revocation have now
been verified. Explicit write consent, creation, retry and revoked replay also passed.
ChatGPT compatibility remains unverified.** Do not treat this document as a completed
real-client acceptance report. The prior Inspector smoke used synthetic authentication.

## Environment and isolation

Run the standalone Compose file from the implementation worktree:

```sh
cd /Users/mr_user/.codex/worktrees/wally-auth0-mcp/wally
docker compose -f docker-compose.mcp-local.yml build api web firestore
docker compose -f docker-compose.mcp-local.yml up -d
```

These build/start commands were exercised. The project name is `wally-mcp-local`.
The API binds this worktree at `/app`; the web binds it at `/repo`. Its Firestore
emulator has no published ports and project ID `wally-mcp-local`. It has no production
credentials, no original-checkout `.env`, and no production database connection.
`AUTH0_SIGNUP_ENABLED=false`; identity mapping is an operator-controlled fixture.
The assistant switch is required for MCP; these MCP tools do not invoke a model.
MCP writes are enabled only in this disposable local profile to test explicit consent.

The original `wally-web-1` was stopped to free its already-registered localhost callback
port. Its container and configuration remain intact. `wally-api-1` was neither stopped,
recreated nor removed; its private migration records remain in place. The separate
`wally-auth0-api-review` and original emulator also remain running. Do not use a bare
`docker compose down`, `make down` or cleanup command against the original project.

Working addresses:

- Wally web: `http://localhost:5174/` (now the PR worktree).
- API health: `http://localhost:4502/health` (200 verified).
- MCP: `http://localhost:4502/mcp` (401 verified without a bearer token).
- Protected-resource metadata:
  `http://localhost:4502/.well-known/oauth-protected-resource/mcp` (200 verified).
- Inspector: `http://localhost:6274/`; use the session-authenticated URL printed by
  `docker compose -f docker-compose.mcp-local.yml logs inspector`.

The Inspector session token is a local credential. Do not put it in Git, shared
screenshots, this document, or a public issue. Session authentication remains enabled.
Inspector listens on all interfaces **inside the isolated container network namespace**;
only host loopback ports 6274/6275 are published. Inspector shares the API's network
namespace so its backend and the browser agree on `localhost:4502`. Settings persist
in an isolated Docker volume; OAuth secrets currently use Inspector's session memory
fallback, so restarting Inspector requires authentication again.

## Discovery and OAuth boundaries

`MCP_LOCAL_URL=http://localhost:4502/mcp` changes the advertised resource, challenge
metadata URL and internal transport request URL. It is rejected unless the process is
in development with an emulator and an explicit localhost HTTP `/mcp` URL. No request
header chooses this address. The local profile additionally allows precisely
`http://localhost:6274` as an Inspector origin. Arbitrary ports and `Origin: null`
remain rejected; production defaults are unchanged.

JWT verification still requires RS256, issuer `https://login.luminull.com/`, the
registered MCP audience `https://api.wally.luminull.com/mcp`, the configured exact
client ID, a recent issuance time and `wally:read`. Wally's current identity,
owner policy, board roles, durable consent and write checks remain mandatory.

The seeded Inspector server `wally-local` uses Streamable HTTP and the approved public
PKCE client `tpc_oR2NUn5BAcms9r5Z5MhHVf`, without a client secret. Its initial configured
scopes are `openid profile email wally:read`. It supplies an explicit authorization
parameter `audience=https://api.wally.luminull.com/mcp` for the local transport alias.
Auth0 documents that an explicit audience takes precedence over resource:
[Resource Parameter Compatibility Profile](https://auth0.com/ai/docs/mcp/guides/resource-param-compatibility-profile).
This local alias strategy is not evidence that a generic host can discover the production
endpoint correctly; real Inspector token exchange subsequently passed; generic-host compatibility remains separate.

On 2026-10-20 the owner approved adding exactly
`http://localhost:6274/oauth/callback` to that client's existing callback list.
The change was saved. Its existing ChatGPT callback and API scopes were preserved.
Current dashboard readback showed two delegated MCP permissions and denied machine-to-machine
access. No new client, Management API grant, production login switch or production MCP
activation was created. Free-plan entitlement outside the active trial remains unverified.

## Synthetic fixture

Use a private JSON file with the exact reviewed Auth0 subject and email, with keys
`subject` and `email`. Do not infer a subject by email matching. In this session the
operator reused the exact owner identity from the prior isolated emulator fixture;
the subsequent real login resolved to that fixture identity and displayed its three boards.
The file is private operator material, outside the repository.

The following commands were exercised with that file present:

```sh
docker cp /private/tmp/wally-mcp-local-fixture-identity.json \
  wally-mcp-local-api-1:/tmp/wally-mcp-local-fixture-identity.json
docker compose -f docker-compose.mcp-local.yml exec -T api \
  pnpm --filter @wally/api exec tsx src/seed-mcp-local.ts \
  /tmp/wally-mcp-local-fixture-identity.json
```

The seeder refuses non-emulator operation and any database project except the isolated
local project or its dedicated test namespace. It creates synthetic users, three boards,
a shared-board membership and a note through the existing command layer. It binds the
explicit Auth0 subject to synthetic Wally ID `mcp-local-owner`, never a production user ID.
Reruns preserve existing data, owner policy and grants; note creation uses a stable receipt.

Boards:

- `mcp-local-owner`: **MCP selected board**, owned by the tester; contains a synthetic note.
- `mcp-local-unselected`: **MCP unselected board**, also owned by the tester.
- `mcp-local-shared`: **MCP shared owner-blocked board**, owned by a synthetic other user;
  the tester has EDIT membership and cannot enable its owner policy.

No MCP board policy or connection grant is seeded. Consent must be exercised through
Wally or its authenticated routes. New grants require a newly issued MCP token; the same
second as grant creation is intentionally rejected. Do not change issuance timestamps or
prepopulate grants to make an older OAuth token pass.

## Acceptance checklist

- [x] Verify PR worktree/head and current green PR CI.
- [x] Build/start isolated Docker API, web, emulator and Inspector; verify source mounts.
- [x] Verify health, public local discovery and unauthenticated MCP challenge.
- [x] Seed synthetic data without implicitly granting MCP access.
- [x] Add owner-approved Inspector callback and reach real Auth0/Google login.
- [x] Complete real Auth0 code exchange through Inspector; strict server verifier accepted read and write sessions.
- [x] Verify AI connections controls using real web login.
- [x] Verify owner policy and read-only board consent.
- [x] Verify authorized board/note reads and unselected-board denial with real tokens.
- [ ] Verify non-owner policy denial and current board-role enforcement.
- [x] Revoke and verify denial on the next real MCP call.
- [x] Explicitly approve writes, reauthorize token scopes, verify write/retry and revoked replay.
- [x] Record final working OAuth/UI acceptance steps and fresh test evidence.
- [ ] Verify ChatGPT separately using an authorized reachable test endpoint.

Automated tests, historical synthetic Inspector results, real Auth0 MCP acceptance,
and ChatGPT compatibility are separate evidence categories. Do not check a later gate
from an earlier category. This task authorizes no merge, deploy or production activation.

## Automated verification in this continuation

API lint, typecheck and build passed. The full API suite passed **65 files / 689 tests**
with two file workers, preserving the concurrent requests inside tests:

```sh
docker compose -f docker-compose.mcp-local.yml exec -T \
  -e AUTH0_ENABLED=false -e ASSISTANT_ENABLED=false \
  -e MCP_ENABLED=false -e MCP_WRITES_ENABLED=false \
  api env -u MCP_LOCAL_URL pnpm --filter @wally/api exec vitest run --maxWorkers=2
```

Two earlier unrestricted runs were not clean: one timed out in
`test/board-safety.test.ts` (“concurrent identical copies and subtasks commit each effect
once”); another returned `[200, 500]` in `test/auth0-signup.test.ts` (“concurrent requests
from one subject create one account and one board”). Emulator logs showed transaction
lock timeouts. The reduced file-worker run passed both with unchanged assertions.
This is automated emulator evidence; the unrestricted local run is not claimed green.

These tests include the existing synthetic-verifier MCP suites and signed test-key JWT
checks; they do not constitute an Inspector session authenticated by real Auth0 tokens.
The web source was not changed and its suite was not rerun in this continuation.
The prior green PR browser run remains separate historical CI evidence.

These changes were prepared for a local commit on codex/auth0-mcp after independent
review found no blocking security or correctness issues. Nothing was pushed, merged or deployed. Both real read and write acceptance sequences below completed. The local connection
was left revoked after testing; reconnecting requires fresh Wally consent and authorization.

## Real Auth0 Inspector evidence (2026-10-20 continuation)

The owner completed Google login and Auth0 consent in the in-app browser. The local
Wally app displayed all three fixtures. Navigate via Profile & preferences → AI
connections within the signed-in app. A full URL navigation in this session returned
to login; the existing Auth0 session recovered after consent. Reload persistence still
needs investigation; do not describe it as verified.

Working UI sequence:

1. Enable External AI access for MCP selected board, select that board, leave Allow
   changes unchecked, and click Approve selected boards.
2. Open the authenticated Inspector URL in the same browser, connect wally-local,
   and accept the Auth0 read/offline consent returning to localhost:6274/oauth/callback.
3. Inspector completed INITIALIZE and TOOLS/LIST with real Auth0 authentication.
   Five read tools appeared; no write tools appeared.
4. Tools → list_boards → Execute Tool returned only mcp-local-owner, role OWNER.
5. get_board with boardId mcp-local-owner returned metadata and revision 1.
   get_board with mcp-local-unselected returned NOT_FOUND, without board data.
6. list_notes with boardId mcp-local-owner returned the single Synthetic MCP read fixture.
7. In Wally, Revoke ChatGPT changed the connection to Revoked. Repeating list_notes
   in the still-connected Inspector failed with MCP_CONSENT_REQUIRED.

Write preparation completed: selected the same synthetic board, checked Allow changes,
and approved. Wally shows Active · Read and change. In Inspector disconnected, opened
Settings → OAuth Settings, set Scopes to openid profile email wally:read wally:write,
cleared stored OAuth state, closed settings and reconnected. Auth0 visibly requests
Read, Write and offline access. The owner accepted this prompt and the real write sequence below passed. No token values were copied into this report. ChatGPT itself was
not tested; the client display name is not ChatGPT compatibility evidence.

### Real write acceptance

After the owner accepted Read, Write and offline access, Inspector reconnected and
listed 13 tools (the five read tools plus eight write tools).

1. Tools → create_note: boardId `mcp-local-owner`, title
   `Real Auth0 MCP write validation`, operationId
   `de9423a3-30e0-4c15-934d-fda761cc71bf`; leave other form defaults unchanged.
   Execute Tool created note `ms6RUlgqUBF9E3Yk8zjn`, revision 1.
2. Close results → Execute Tool again without edits returned the same note ID,
   revision and creation timestamp (2026-10-20T19:47:49.960Z).
3. Close results; change boardId to `mcp-local-unselected` and operationId to
   `0b6b0f94-82bc-4f6d-865d-4ec55d38b16c`. Execute Tool returned NOT_FOUND.
4. Wally AI connections → Revoke ChatGPT. Return to the create form, restore
   the original boardId and operationId, and execute the identical successful
   request. It failed with MCP_CONSENT_REQUIRED; the old receipt did not bypass
   revocation. Both read-only and write connection records now show Revoked.

Use fresh UUIDs for new test creations; reuse an identical UUID/input only when
intentionally testing retries. The tested connection is left revoked, and Inspector
settings retain the explicitly requested read/write scopes. Auth0 grant acceptance
is separate from Wally board consent. No production MCP endpoint was enabled.

Limitations: direct API denial of non-owner policy edits and membership changes during
an active session remain covered by automated tests, not this real-token UI sequence.
Inspector reported one schema-portability warning each on create_note and assign_note;
create_note executed successfully. Generic client/schema portability and ChatGPT
acceptance remain separate work. Full-navigation web session persistence also needs
investigation, as recorded above. No new automated suite run was needed for these UI
checks; the earlier 689-test result is the automated evidence, not a new run.

## Follow-up investigation: localhost reload and schema warnings

Reloading the signed-in AI connections page reproduced the return to `/login`.
The application deliberately configures `cacheLocation: memory`, refresh tokens and
iframe fallback in `apps/web/src/features/auth/auth0Session.ts`. The installed SDK's
`checkSession` invokes silent token recovery and catches its errors; no browser-console
error was emitted in this reproduction. Auth0's official SPA SDK documentation states
that in-memory refresh tokens are lost on reload and consent cannot be skipped on
localhost: https://auth0.com/docs/libraries/auth0-single-page-app-sdk . This explains why
interactive consent was required again in the observed local flow. We did not capture
the precise silent-auth error, so cookie blocking or another provider condition is not
ruled out. This is a reproducible local limitation, not evidence of production behavior.

Keep the intended memory-only token policy. For this local runbook, sign in after a full
reload and use Wally's in-app navigation (Profile & preferences → AI connections) while
testing. Do not switch tokens to persistent browser storage or disable consent merely
to make the localhost test appear seamless. Production-origin silent renewal remains a
separate verification gate.

Expanded Inspector's warning: `inputSchema.properties.input.properties.assigneeId`
uses legal JSON Schema `type: ["string", "null"]`. Inspector warns that some clients
map schemas to narrower dialects; it reports zero schema errors. This applies to
create_note and assign_note and preserves the explicit-null assignment contract.
No demonstrated Inspector failure warrants changing the shared schema. Any future
client-specific conversion must retain null-vs-absent semantics and be tested against
that actual client. ChatGPT remains unverified.

Fresh focused verification after this investigation: 2 files / 17 tests passed:

```sh
docker compose -f docker-compose.mcp-local.yml exec -T web \
  pnpm --filter @wally/web exec vitest run \
  src/features/auth/auth0Session.test.ts \
  src/features/auth/Auth0SessionProvider.test.tsx
```

The browser was left on Wally's login page following the intentional reload reproduction;
Inspector retains the revoked test session. No new grant was created during investigation.
