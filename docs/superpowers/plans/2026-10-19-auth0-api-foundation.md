# Auth0 API foundation implementation plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. Track completion below.

**Goal:** Add opt-in Auth0 REST authentication and mapping imported identities to existing Wally accounts, the first implementation slice of the rollout.

**Architecture:** Verify Auth0 access tokens at the API boundary, then resolve their issuer/subject through an application-owned identity map. Existing Firebase authentication and Wally authorization continue to work; unlinked Auth0 identities cannot provision replacement accounts. Only trusted migration code binds imported Auth0 subjects to known Wally IDs; no public account-linking endpoint is added.

**Tech Stack:** Fastify, TypeScript, jose, current Firestore store, Vitest/emulator.

**Spec:** [Auth0 and MCP rollout](../../rfcs/AUTH0_MCP_ROLLOUT.md).

## Constraints and review focus

- REST audience `https://api.wally.luminull.com`; issuer `https://login.luminull.com/`.
- Planned MCP resource `https://api.wally.luminull.com/mcp` must not authenticate REST calls.
- Auth0 support defaults off. No production cutover, web login change or MCP endpoint in this slice.
- Preserve stable IDs, preferences, memberships and verified-email invite rules. Never link by email.
- Concurrent linking cannot reassign an identity; bad tokens cannot fall back to a more permissive verifier.
- No tokens in logs or persisted identity records. Missing/unverified profile claims fail closed.
- Existing uncommitted UI/docs changes belong to other work and must be preserved.

## Tasks

### 1. Verify Auth0 access tokens

Files: `apps/api/src/lib/auth/auth0.ts`, its unit tests, `apps/api/src/env.ts`, API dependency and lockfile.

Interface: `AccessTokenVerifier.verify(token)` returns verified `{ issuer, subject, email, emailVerified, name }`. Production uses pinned issuer JWKS, RS256, exact REST audience, expiration and required profile claims under `https://wally.luminull.com/`.

- [x] Write failing signed-token tests for valid claims, wrong signature/issuer/audience, expiration, ID tokens and missing claims.
- [x] Implement verifier and validated opt-in environment configuration.
- [x] Run tests and type checks.

### 2. Resolve and link existing identities

Files: `apps/api/src/lib/auth/identities.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/app.ts`, integration tests.

Interface: `resolveIdentity(db, identity)` returns existing Wally user ID or a recoverable `IDENTITY_NOT_LINKED` error. `bindImportedIdentity(db, identity, userId)` atomically inserts an immutable mapping and is idempotent only for that same user. The binding function is a trusted migration boundary, never called from an HTTP route.

- [x] Write failing emulator tests for unlinked identity, successful imported mapping and subsequent REST access using the original ID, conflicting and concurrent imports, invalid tokens, preserved preferences and verification behavior.
- [x] Implement identity records and optional Auth0 verifier integration without changing existing Firebase tests.
- [x] Run API suite, lint/typecheck and running health check; review security boundaries.

### 3. Document activation and remaining gates

Files: root/API environment examples, deployment guidance, rollout RFC and MCP connection contract.

- [x] Document Auth0 audience/RS256/Action claims configuration, API activation and rollback. No secrets in source.
- [x] Record new identity data and retention implications in privacy inventory.
- [x] Add proposed `GET /me/connections` and `DELETE /me/connections/:connectionId` contract to RFC; keep these explicitly unimplemented.
- [x] Format/check changed files and record actual verification.

## Remaining rollout work

Web Auth0 SDK and controlled import with required Auth0 password reset for existing email/password users (owner decision); custom-domain release checks and production variables; actual Auth0 configuration and end-to-end sign-in; read-only MCP plus grants and ChatGPT compatibility (first host selected); bounded writes and security review remain tracked by the parent RFC. This slice makes no completion claim for those gates.

## Verification record

- Full workspace tests, lint and typecheck passed in Docker with `ASSISTANT_ENABLED=false`: 585 API tests and 778 web tests. Eight existing frontend lint warnings remain.
- Final focused security suite: 18 tests passed, including two additional disabled-feature/no-fallback tests.
- Running local API: `/health` 200 and unauthenticated `/me` 401.
- Independent review identified a deletion race; a failing regression test reproduced it, and the transaction now refuses creation for Auth0 identities.
- No production deployment, Auth0 tenant mutation, user import or reset email was performed.
- Ruling: the owner selected Auth0 password resets instead of the proposed dual-login linking UI. This slice provides the trusted import binding boundary; controlled import, recovery and frontend cutover remain rollout gates.
