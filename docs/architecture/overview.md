# Architecture overview

This document describes Wally at the system level: what the repository contains, how the parts relate, and where the boundaries are. It follows the [C4 model](https://c4model.com/); levels 1 and 2 live here. Decisions and their reasons are in the [ADRs](../adr/README.md).

It describes production today. The decided move to Supabase and Cloudflare is planned in [RFC-0011](../rfcs/RFC-0011-platform-migration.md); nothing is migrated yet.

## Level 1: System context

_Who uses Wally and which systems it talks to._

```mermaid
flowchart LR
  user["Wally user<br/>[Person]<br/>Owns one or more whiteboards, may be a member of others"]
  wally["Wally<br/>[System]<br/>Whiteboard of movable to-do notes"]
  host["MCP client, e.g. ChatGPT<br/>[External]<br/>Reads and edits boards for a user"]
  auth0["Auth0<br/>[External]<br/>Email/password and Google sign-in for web and MCP"]
  fbauth["Firebase Authentication<br/>[External]<br/>Local and CI sign-in only"]
  store["Cloud Firestore<br/>[External]<br/>All application data"]
  model["Vertex AI<br/>[External]<br/>Model for the built-in assistant"]
  user -->|uses, in German or English| wally
  user -->|signs in| auth0
  user -->|connects| host
  host -->|OAuth| auth0
  host -->|MCP| wally
  wally -->|verifies access tokens| auth0
  wally -->|verifies ID tokens, local and CI only| fbauth
  wally -->|reads and writes| store
  wally -->|assistant requests| model
```

## Level 2: Containers

_The deployable units and how they communicate._

```mermaid
flowchart LR
  browser["Browser"]
  host["MCP client"]
  auth0["Auth0<br/>login.luminull.com"]
  subgraph wally["Wally (Google Cloud project luminull-wally)"]
    web["web<br/>React SPA, Vite<br/>Firebase Hosting, wally.luminull.com"]
    api["api<br/>Fastify, Node 22, REST and /mcp<br/>Cloud Run, europe-west1, api.wally.luminull.com"]
    store[("Cloud Firestore<br/>database wally, europe-west3")]
    model["Vertex AI<br/>location eu"]
  end
  browser -->|HTTPS| web
  browser -->|sign-in, access token| auth0
  host -->|OAuth, access token| auth0
  browser -->|REST, Bearer access token| api
  host -->|MCP, Bearer access token| api
  api -->|verify token| auth0
  api -->|Admin SDK| store
  api -->|assistant| model
```

The browser never talks to Firestore. [`firestore.rules`](../../firestore.rules) denies every direct read and write; the Admin SDK bypasses rules, so the API is the only door ([ADR-0003](../adr/ADR-0003-firestore-reached-only-through-the-api.md)).

## The life of a request

1. The browser attaches a fresh access token to every call made through `apiClient.ts`: an Auth0 access token in production, a Firebase ID token locally and in CI. MCP clients send their own Auth0 access token to `/mcp`.
2. The `preHandler` in [`apps/api/src/plugins/auth.ts`](../../apps/api/src/plugins/auth.ts) verifies the token, resolves the Wally user through `authIdentities` ([AUTH0.md](../AUTH0.md#stable-account-ids)) and, on the caller's first request, creates their user record and their own whiteboard in one transaction ([ADR-0004](../adr/ADR-0004-firebase-auth-with-lazy-provisioning.md)).
3. Board routes adapt transport to shared `lib/commands` functions; the command schema is validated again at the application boundary. Identity comes from the verified token.
4. A write transaction reads its receipt, board permissions and affected records, checks role, scope and expected integer revision, and commits data, denormalized fields and a receipt together. Authorized retries replay that result. Missing preconditions fail with 428; stale writes and changed-payload retries fail with 409.
5. The browser serializes work per note or board administration aggregate and advances only from its own acknowledged writes. Remote changes require draft review; failed optimism rolls back only fields owned by the failed operation. Text drafts remain separate from server data until acknowledged.
6. Deletion commits a hidden tombstone and durable cleanup job. Recursive cleanup runs immediately and can resume through a retry or maintenance command. Account changes abort and clear queued browser work.

The full command contract and operating procedures are in [Board operations](board-operations.md) and [ADR-0010](../adr/ADR-0010-board-commands-revisions-and-receipts.md).

## Repository layout

| Directory                      | Contains                                                                                                                                                                                   | Deployable |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `apps/api`                     | Fastify REST API and MCP endpoint: `routes/`, `plugins/` (firestore, firebase, auth), `lib/` (including `auth/`, `mcp/`, `assistant/`, `commands/`), tests                                 | yes        |
| `apps/web`                     | React SPA: `features/` (auth, board, boards, landing), `i18n/`, `components/ui/`, `e2e/`                                                                                                   | yes        |
| `packages/shared`              | Zod schemas, enums, constants and query helpers used by both apps                                                                                                                          | no         |
| `packages/config`              | Shared ESLint, Prettier and TypeScript base config                                                                                                                                         | no         |
| `infra/`                       | The Firestore emulator image, the Auth0 Post Login Action, the HTTPS proxy config for Auth0 E2E runs, the local MCP Inspector config                                                       | no         |
| `scripts/`                     | One-time Google Cloud bootstrap for keyless deploys; release helpers (API domain check, image and runtime config, rollback state, index wait) with their tests; the Post Login Action test | no         |
| `.github/`                     | CI and release workflows, PR template, Dependabot                                                                                                                                          | no         |
| `firebase.json`, `firestore.*` | Hosting, named database, rules and composite indexes, deployed by the release                                                                                                              | no         |

The monorepo is pnpm workspaces under Turborepo ([ADR-0002](../adr/ADR-0002-pnpm-turborepo-monorepo-with-shared-contract.md)). Everything runs in Docker Compose locally and in CI ([ADR-0009](../adr/ADR-0009-docker-compose-with-firestore-emulator-and-real-auth.md)).

## Data model

Document shapes are declared in [`apps/api/src/lib/db/types.ts`](../../apps/api/src/lib/db/types.ts); there is no schema and no migration step.

| Collection                                              | Holds                                                                                                                                                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users/{uid}`                                           | Email (lowercase), display name, `emailVerified`, `language`, UI preferences including per-board view settings                                                                                                       |
| `whiteboards/{id}`                                      | Name, owner, `memberRoles` (uid to role, a read cache of active members), the share-link token. The first board's id is the owner's uid; later boards have generated ids. `deletedAt` marks a board awaiting cleanup |
| `whiteboards/{id}/members/{id}`                         | Invited email or user, role (EDIT or VIEW), status. Source of truth for `memberRoles`                                                                                                                                |
| `notes/{id}`                                            | Title, description, status, horizon, priority, free position, due date, assignee, tags, custom fields, colour, `visibility`, `subtaskSummary`                                                                        |
| `notes/{id}/subtasks/{id}`                              | Text, done, sort index                                                                                                                                                                                               |
| `notes/{id}/history/{id}`                               | CREATED and MOVED events with actor and metadata                                                                                                                                                                     |
| `shareLinks/{token}`                                    | Board and the role the link grants                                                                                                                                                                                   |
| `authIdentities/{id}`                                   | `(issuer, subject)` mapped to a Wally user id ([AUTH0.md](../AUTH0.md#stable-account-ids))                                                                                                                           |
| `users/{uid}/mcpConnections`, `users/{uid}/mcpLimits`   | Account-wide MCP connection records and the MCP request and write budgets ([connection model](../MCP_CONNECTION_MODEL.md))                                                                                           |
| `users/{uid}/boardOperations/{id}`, `boardCleanup/{id}` | Command receipts (7-day TTL) and durable cleanup jobs ([Board operations](board-operations.md))                                                                                                                      |
| `users/{uid}/assistant*`                                | Assistant usage, attempts, conversations, suggestions and tidies; `assistantAudit` and the deployment-wide `assistantSpend` are top-level ([RFC-0003](../rfcs/RFC-0003-wally-agent.md))                              |

Notes are top-level rather than nested under their board because routes address a note by id alone. A note keeps three independent placements, one per board mode (horizon, priority, free), and a move changes only its own mode's field.

## Boundaries and rules

- Only the API talks to Firestore. The web app has no Firestore client. [ADR-0003](../adr/ADR-0003-firestore-reached-only-through-the-api.md)
- Identity comes from Auth0 in production (Firebase Authentication locally and in CI, not as a production fallback); permissions are Wally's own, enforced in the API. [ADR-0004](../adr/ADR-0004-firebase-auth-with-lazy-provisioning.md), [ADR-0016](../adr/ADR-0016-auth0-for-web-and-mcp.md)
- The contract between the apps is the Zod schemas in `@wally/shared`; neither app imports the other's source. [ADR-0002](../adr/ADR-0002-pnpm-turborepo-monorepo-with-shared-contract.md), [ADR-0005](../adr/ADR-0005-rest-api-validated-with-shared-zod-schemas.md)
- There is no real-time channel. Members of a shared board see each other's changes on the next refetch. [ADR-0006](../adr/ADR-0006-server-state-in-tanstack-query-no-realtime.md)
- UI text lives in the web catalogues; identifiers, enum values and API messages are English; the German stored values were replaced in one release with a data reset ([ADR-0024](../adr/ADR-0024-rename-persisted-values-without-migration.md)). [ADR-0007](../adr/ADR-0007-ui-text-in-bundled-i18next-catalogues.md), [ADR-0014](../adr/ADR-0014-english-identifiers-and-persisted-values.md)
- A release is a `v*` tag on `main`, deployed keyless with a smoke test and automatic rollback. [ADR-0008](../adr/ADR-0008-tag-triggered-release-to-hosting-and-cloud-run.md)

## Related documents

- [ADR index](../adr/README.md)
- [Setup and conventions](../SETUP.md), [Deploying](../DEPLOY.md), [GDPR](../GDPR.md)
- [Product spec](../SPEC.md)
- [Wally assistant](../rfcs/RFC-0003-wally-agent.md) and [Wally over MCP](../rfcs/RFC-0004-wally-mcp.md)
- [Platform migration](../rfcs/RFC-0011-platform-migration.md), planned
