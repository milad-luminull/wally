# MCP connection model

> **2026-10-26:** Supabase Auth replaces Auth0 as the MCP authorization server
> ([ADR-0021](adr/ADR-0021-supabase-auth-for-web-and-mcp.md),
> [Supabase Auth RFC](rfcs/RFC-0012-supabase-auth-and-mcp.md)). The behavior here still applies.
> What changes:
>
> - Sign-in happens through Supabase.
> - Supabase documents no custom OAuth scopes, so "OAuth token scopes" in the permission
>   intersection below becomes Wally's own read/write setting on the connection record.

Approved 2026-10-22. Supersedes the per-board owner-policy and selected-board consent
model for new connections. First released to production in v0.8.3 (2026-10-25).

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

There is one connection model: current Wally permissions. The earlier selected-board
grants, owner policy API, access-version fields and upgrade UI were deleted rather than
migrated.

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

## Verification

API tests cover:

- concurrent automatic connection;
- new board discovery;
- viewer denial;
- membership removal;
- private-note visibility;
- write retries;
- revocation race windows.

They also reject obsolete board-selection inputs.

UI unit tests cover Connect, Disconnect and failure states. Reconnect, and the state
right after it, are not yet covered end to end.
