# MCP connection model

Approved 2026-10-22. Supersedes the per-board owner-policy and selected-board consent
model for new connections. Production activation remains a separate decision.

## User experience

Connect Wally from ChatGPT, sign into Wally through Auth0 and approve the requested OAuth
capabilities. The first verified MCP request creates an account-wide connected-app record.
No Wally setup, board selection or separate write checkbox is required. Connected apps
shows connection status and Disconnect. New boards and memberships are included dynamically.

The effective permission is the intersection of the current user's Wally permissions,
OAuth token scopes, supported MCP operations and the deployment write switch. Viewers
cannot write. A user's private notes remain hidden from other users, including their
connected apps; their own connected app has the same visibility as they do. There is no
new board privacy flag and no AI-specific owner veto for account-wide connections.
The built-in assistant's global and board switches do not control account-wide MCP.

## Disconnect and reconnect

Disconnect is enforced by a durable record on every MCP request and again inside write
transactions, including idempotent replays. A refreshed token must not undo Disconnect:
access-token issuance time alone does not prove a new interactive authorization.
Therefore a previously disconnected app requires an explicit Reconnect action in Wally,
followed by sign-in from ChatGPT. Reconnect records a token issuance cutoff; tokens issued
at or before that cutoff cannot use the new connection. Revoked records are retained as
revocation tombstones until a separately designed safe retention policy permits deletion.

## First release

This feature has not shipped. The experimental selected-board grants, owner policy API,
access-version fields and upgrade UI have been deleted rather than migrated. There is
only one model: current Wally permissions. On the owner's explicit request, the six
local test connection records for the configured client were deleted and replaced with
one fresh connection in the guarded `wally-mcp-local` emulator. No board/note or production
record was changed. The new connection requires a newly issued OAuth token.

## Authorization and testing constraints

Auth0 issuer, audience, client, expiry and read-scope checks precede automatic connection
creation. New automatic connections require a verified email and an existing mapped Wally
user. Explicit reconnect uses authenticated REST and the configured client ID.
Connection creation runs in a transaction so concurrent initial requests share one record.
Reads recheck current membership; writes recheck membership and revocation transactionally.
Existing revision, operation-ID, note privacy and audit behavior stays in place.
Authenticated MCP requests share a 300/minute per-user and per-connection budget across
instances; writes additionally retain their 60/user and 30/connection per-minute budget.
Exhausted request budgets return HTTP 429 with Retry-After: 60 before tool execution.

Tests use dedicated emulator project IDs only, never the manual `wally-mcp-local` project.
No production data, Auth0 configuration or manual session should be changed as cleanup.
Do not reset manual connections except at the owner's explicit request.

## Verification

Tests cover concurrent automatic connection, new board discovery, viewer denial,
membership removal, private-note visibility, write retries and revocation race windows.
API tests also reject obsolete board-selection inputs and confirm the old board policy
endpoint no longer exists. UI tests cover Connect/Disconnect, failures and reconnect.

After resetting the local connection, a read-only call through the installed ChatGPT
validation connector returned an HTTP 429 tunnel/probe error from the host. It did not
reach a successful Wally tool result. This does not establish new end-to-end OAuth
acceptance; isolated protocol tests and real-host acceptance remain separate evidence.

Final verification on 2026-10-22: 698 API tests (66 files) passed with one worker;
849 web tests (101 files) passed. The first two-worker API run had one failure in the
previously observed concurrent Auth0 signup test (200/500); its eight-test isolated suite
passed, followed by the complete one-worker pass. This records the local emulator
flakiness rather than claiming it was fixed. API/web typechecks, API build, lint and
format checks passed. Independent review found no important issues; obsolete API-client
exceptions for the deleted policy endpoint were removed. Browser verification confirms
one ChatGPT row with Connected and Disconnect, no upgrade controls.
