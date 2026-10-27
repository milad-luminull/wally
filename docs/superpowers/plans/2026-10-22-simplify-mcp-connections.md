# Simplify MCP connections implementation plan

> **Status:** executed. Merged in PR #66 and first released in v0.8.1.

> Execute inline with superpowers:executing-plans.

**Goal:** First-release OAuth connections inherit normal Wally permissions.
**Architecture:** One durable connection model, live role checks, OAuth scopes and immediate
revocation. No selected-board list, owner MCP policy, versioned access or upgrade flow.
**Spec:** User-approved model and explicit instruction to remove unshipped compatibility
and delete/recreate the local connection, 2026-10-22.

## Constraints

No production changes. Preserve boards/notes and the original container/dirty checkout.
Only the named local test connection may be reset, as explicitly requested.
Keep JWT validation, scopes, private-note rules, transactional authorization, revisions,
write switches, rate limits and idempotency. Disconnect must not be undone by token refresh.

## Tasks

- [x] Remove selected-board policy helpers/endpoints and access-version fields.
- [x] Remove upgrade UI/copy; show Connected and Disconnect.
- [x] Update regression tests to current membership and deny obsolete API inputs.
- [x] Delete/recreate the local test connection with emulator/project guards.
- [x] Complete final suites, type/lint/format checks and browser verification.

## Reconnect decision

A refreshed token is not proof of interactive OAuth reconnection. Retain a durable
revocation record and require an explicit reconnect action after Disconnect, then a fresh
token. This is current disconnect enforcement, not backward compatibility.
