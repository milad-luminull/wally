# Simplify MCP connections implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task.

**Goal:** Connect once through OAuth and inherit current Wally permissions with one Disconnect control.
**Architecture:** New authenticated MCP clients receive a durable account-wide connection automatically. Legacy selected-board grants remain restricted until explicit upgrade; disconnected clients cannot reactivate with an old token. Reuse live membership and private-note authorization on every read and transactional write/replay.
**Tech Stack:** Existing Fastify, Firestore, Zod, React, Vitest; no new dependencies.
**Spec:** User-approved description in this conversation on 2026-10-22.

## Constraints

No production writes or configuration changes. Preserve original dirty checkout, original API container, local fixtures and active manual grants. Do not silently broaden legacy connections. Do not add board privacy controls. Keep JWT issuer/audience/client/scope validation, write feature switch, rate limits, revisions and idempotency. MCP must not depend on the built-in assistant switch.

## Review focus

Concurrent initial calls must create one connection. A disconnected token must remain blocked. Legacy grants must not expand without approval. Membership removal and viewer roles must apply to transactional retries. New boards must appear without reconnecting.

## Tasks

- [x] Add regression tests in apps/api/test/mcp-grants.test.ts for automatic account-wide connections, concurrent calls, disconnect, upgrade, live membership and role checks; run failing tests.
- [x] Implement versioned access in apps/api/src/lib/mcp/grants.ts and packages/shared/src/schemas/mcp.ts; keep legacy restrictions until explicit authenticated upgrade.
- [x] Wire automatic connection establishment in routes/mcp.ts, dynamic board enumeration in lib/mcp/tools.ts, and an upgrade endpoint in routes/connections.ts. Remove MCP dependence on assistant enablement in app.ts, environment validation and release guard.
- [x] Replace ConnectionsPage.tsx with connected-app status, Disconnect, legacy upgrade disclosure and OAuth setup guidance. Update English/German copy and focused UI tests.
- [x] Run API/web suites, typechecks, formatting and relevant guards. Review authorization and retry paths. Update RFC/local-validation/readiness documents to distinguish superseded selected-board behavior from new behavior.

## Execution notes

Ruling: after Disconnect, require an explicit Reconnect in Wally before accepting fresh
OAuth tokens. A refreshed token alone cannot prove interactive reconnection; this preserves
immediate revocation without adding Auth0 Management credentials or new dependencies.
Legacy routes/helpers remain solely for backward compatibility; new UI never uses them.

Validation: 708 API / 851 web tests passed, API/web types and API build passed. Independent
review completed; obsolete consent challenge copy fixed. Real Auth0 Wally UI inspected,
manual grant preserved. New account-wide ChatGPT acceptance remains separately pending.
