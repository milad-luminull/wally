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

## Existing connections

Records without `access: all` retain their existing selected-board, owner-policy and scope
restrictions. Nothing silently broadens them. A one-time **Use my Wally permissions**
action clearly explains the expanded board and supported-write coverage and upgrades the
same connection. OAuth scopes still cap access, so a read-only token stays read-only.
This upgrade does not revoke the connection or force existing tokens to expire.
Legacy API helpers/routes remain temporarily for compatibility; new clients and the UI
never create selected-board grants. Historical policies have no effect on account-wide
connections. They must not be removed while legacy grants still depend on them.

## Authorization and testing constraints

Auth0 issuer, audience, client, expiry and read-scope checks precede automatic connection
creation. New automatic connections require a verified email and an existing mapped Wally
user. Explicit upgrade/reconnect uses authenticated REST and the configured client ID.
Connection creation runs in a transaction so concurrent initial requests share one record.
Reads recheck current membership; writes recheck membership and revocation transactionally.
Existing revision, operation-ID, note privacy, audit and rate-limit behavior stays in place.

Tests use dedicated emulator project IDs only, never the manual `wally-mcp-local` project.
No production data, Auth0 configuration or manual session should be changed as cleanup.
An existing manual connection must only be upgraded through an explicit user action.

## Verification

Focused tests cover concurrent automatic connection, dynamic board access, viewer denial,
membership removal, legacy preservation/upgrade, repeated writes and revocation despite
newer tokens. UI tests cover setup without board queries, Disconnect, explicit upgrade,
reconnect, disabled deployment controls and load failure. Full-suite results and real
Auth0/ChatGPT validation must be recorded separately; automated injected-identity HTTP
tests are not proof of a new end-to-end OAuth run.

Verification on 2026-10-22: 708 API tests in 66 files and 851 web tests in 101 files
passed. API/web typechecks and API build passed. The web suite uses VITE_AUTH_PROVIDER=firebase;
running it with the local application's Auth0 setting fails Firebase-provider-specific tests.
The API suite likewise uses isolated test-process flags and removes MCP_LOCAL_URL.
An independent read-only review found no important authorization issues; its stale
consent-error wording finding was corrected. The real local Wally UI was inspected after
normal Auth0 sign-in: Connected apps renders the legacy upgrade and Disconnect controls,
with no board selection/switches. The manual connection was neither upgraded nor revoked.
A fresh account-wide ChatGPT/OAuth acceptance run is still outstanding.
