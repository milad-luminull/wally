# Architecture Decision Records

An ADR records one significant technical decision: the context, the options considered, what was chosen, and the consequences. ADRs are short, numbered, and immutable once accepted.

The format is [MADR](https://adr.github.io/madr/) trimmed to its minimal sections, plus our header fields and the optional Decision drivers, Confirmation and More information. See [`ADR-0000-template.md`](ADR-0000-template.md). An ADR is about one page (300 to 600 words), readable in five minutes, and names at least one bad consequence.

## When to write one

Write an ADR when a decision:

- is hard or expensive to reverse,
- affects more than one package, or the shape of stored data,
- picks between real alternatives that reasonable people would debate,
- or will make someone ask "why did we do it this way?" in a year.

You do not need an ADR for routine choices, library bumps, or anything covered by an existing ADR.

## What does not go in an ADR

An ADR records what was decided and why. Put everything else in its own document and link it from the ADR's More information:

- Rule details, naming conventions and examples: [`../SETUP.md`](../SETUP.md) or [`../BRAND.md`](../BRAND.md).
- Commands, rollout order and operational steps: [`../DEPLOY.md`](../DEPLOY.md).
- Code maps, directory trees and file-by-file detail: [`../architecture/overview.md`](../architecture/overview.md) or the root README.

A guide changes by normal PR as long as it stays inside its ADR. Changing the decision takes a new ADR.

## Process

1. Copy `ADR-0000-template.md` to `NNNN-short-kebab-title.md`, using the next free number.
2. Set status to `proposed` and open a pull request. Discussion happens in the PR.
3. When merged with status `accepted`, the decision is in force. A proposal that is turned down is merged as `rejected`, with the reason, so the debate does not restart.
4. Once accepted, only the status, a `superseded by` link and typo fixes may change. To change a decision, write a new ADR that supersedes the old one, and set the old ADR's status to `superseded by [ADR-NNNN](NNNN-....md)`.
5. Add the new ADR to the index below.

## Statuses

| Status                   | Meaning                                     |
| ------------------------ | ------------------------------------------- |
| `proposed`               | Under discussion in a PR.                   |
| `accepted`               | In force.                                   |
| `rejected`               | Considered and not adopted.                 |
| `deprecated`             | No longer applies, and nothing replaced it. |
| `superseded by ADR-NNNN` | Replaced by a later decision.               |

## Index

| ADR                                                                  | Title                                                                                          | Status                                                    |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [0001](ADR-0001-record-architecture-decisions.md)                        | Record architecture decisions as ADRs                                                          | accepted                                                  |
| [0002](ADR-0002-pnpm-turborepo-monorepo-with-shared-contract.md)         | pnpm + Turborepo monorepo with one shared Zod contract package                                 | accepted                                                  |
| [0003](ADR-0003-firestore-reached-only-through-the-api.md)               | Cloud Firestore as the only data store, reached only through the API                           | superseded by ADR-0020                                    |
| [0004](ADR-0004-firebase-auth-with-lazy-provisioning.md)                 | Firebase ID tokens verified by the API; user and board provisioned on the first request        | accepted; partly superseded by ADR-0011 and ADR-0021      |
| [0005](ADR-0005-rest-api-validated-with-shared-zod-schemas.md)           | Plain REST on Fastify, validated with the shared Zod schemas                                   | accepted                                                  |
| [0006](ADR-0006-server-state-in-tanstack-query-no-realtime.md)           | Server state lives in TanStack Query; no global store and no real-time channel                 | accepted; partly superseded by ADR-0023                   |
| [0007](ADR-0007-ui-text-in-bundled-i18next-catalogues.md)                | UI text in bundled i18next catalogues, German by default, language on the profile              | accepted; context sentence superseded in part by ADR-0014 |
| [0008](ADR-0008-tag-triggered-release-to-hosting-and-cloud-run.md)       | Tag-triggered release to Firebase Hosting and Cloud Run, keyless, with smoke test and rollback | accepted; partly superseded by ADR-0022                   |
| [0009](ADR-0009-docker-compose-with-firestore-emulator-and-real-auth.md) | Local dev and CI run in Docker Compose against the Firestore emulator, with real Firebase Auth | accepted                                                  |
| [0010](ADR-0010-board-commands-revisions-and-receipts.md)                | Board commands with transactional permissions, revisions and receipts                          | proposed                                                  |
| [0011](ADR-0011-boards-as-independent-aggregates.md)                     | Boards as independent aggregates: several per owner, deletable, with a tombstone               | proposed                                                  |
| [0012](ADR-0012-skip-e2e-on-documentation-only-pull-requests.md)         | Skip E2E on documentation-only pull requests                                                   | proposed                                                  |
| [0013](ADR-0013-model-library-behind-an-owned-boundary.md)               | The Vercel AI SDK as the model library, behind a boundary Wally owns                           | accepted                                                  |
| [0014](ADR-0014-english-identifiers-and-persisted-values.md)             | English identifiers and persisted values, migrated in place (expand, migrate, contract)        | proposed                                                  |
| [0015](ADR-0015-cloudflare-dns-and-wally-custom-domains.md)              | Cloudflare DNS for Wally custom domains                                                        | superseded by ADR-0022                                    |
| [0016](ADR-0016-auth0-for-web-and-mcp.md)                                | Auth0 for web login and MCP authorization                                                      | superseded by ADR-0021                                    |
| [0020](ADR-0020-supabase-postgres-through-the-api-with-drizzle.md)       | Supabase PostgreSQL with Drizzle, reached only through the API                                 | accepted                                                  |
| [0021](ADR-0021-supabase-auth-for-web-and-mcp.md)                        | Supabase Auth for web login and MCP authorization                                              | accepted                                                  |
| [0022](ADR-0022-cloudflare-pages-and-api-proxy.md)                       | Cloudflare Pages for the web app and a Worker proxy for the API domain                         | accepted                                                  |
| [0023](ADR-0023-supabase-realtime-for-notification-events.md)            | Supabase Realtime for small, recipient-only notification events                                | accepted                                                  |
