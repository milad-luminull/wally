# Documentation

Technical documentation for Wally. Everything here is Markdown, lives next to the code, and is reviewed in the same pull request as the change it describes.

## Where things go

| What                          | Where                                                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture                  | [`architecture/overview.md`](architecture/overview.md)                                 | System context, containers, the data model and the boundaries between them. C4-style diagrams in Mermaid.                                                                                                                                                                                                                                                                                       |
| Board operations              | [`architecture/board-operations.md`](architecture/board-operations.md)                 | The board command contract: revisions, receipts, retries, cleanup and maintenance.                                                                                                                                                                                                                                                                                                              |
| Architecture Decision Records | [`adr/`](adr/)                                                                         | One file per decision that is hard to reverse. [`adr/README.md`](adr/README.md) is the index, with each decision's status in production, and the process.                                                                                                                                                                                                                                       |
| Product requirements          | [`SPEC.md`](SPEC.md)                                                                   | What the app does, mode by mode.                                                                                                                                                                                                                                                                                                                                                                |
| Setup and working conventions | [`SETUP.md`](SETUP.md)                                                                 | Monorepo layout, stack, commands, test policy, definition of done.                                                                                                                                                                                                                                                                                                                              |
| Deploying and operating       | [`DEPLOY.md`](DEPLOY.md)                                                               | Firebase Hosting, Cloud Run, Firestore, the release workflow and rollback.                                                                                                                                                                                                                                                                                                                      |
| Standards                     | [`BRAND.md`](BRAND.md), [`GDPR.md`](GDPR.md)                                           | Visual identity and voice; data inventory and open obligations.                                                                                                                                                                                                                                                                                                                                 |
| Proposals                     | [`rfcs/`](rfcs/)                                                                       | Numbered RFCs, oldest first. [`rfcs/README.md`](rfcs/README.md) is the index, with each RFC's status in production. Start with the assistant ([`0003`](rfcs/RFC-0003-wally-agent.md)), MCP ([`0004`](rfcs/RFC-0004-wally-mcp.md)) and the platform migration ([`0011`](rfcs/RFC-0011-platform-migration.md)). Historical decisions and execution details remain in ADRs, plans and Git history. |
| Research                      | [`researches/`](researches/)                                                           | Dated research and the owner's stack brief. References, not decisions.                                                                                                                                                                                                                                                                                                                          |
| Plans and specs               | [`superpowers/plans/`](superpowers/plans/), [`superpowers/specs/`](superpowers/specs/) | Dated implementation plans and design specs. Each carries a status line naming the PR that executed it; executed plans are historical.                                                                                                                                                                                                                                                          |

The root [`README.md`](../README.md) covers how to run, test and deploy the app.

## What production runs today

Checked against the code on 2026-10-27. Production runs **v0.10.1** (deployed 2026-10-27), which
is everything on `main` up to #81. The v0.10.0 release failed to deploy and never served traffic.

| Part                | Today                                                                        | Decided by                                                                                                                                                 | Planned replacement                                                                                           |
| ------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Data                | Cloud Firestore, reached only through the API                                | [ADR-0003](adr/ADR-0003-firestore-reached-only-through-the-api.md)                                                                                         | Supabase PostgreSQL ([ADR-0020](adr/ADR-0020-supabase-postgres-through-the-api-with-drizzle.md)), not started |
| Web and MCP sign-in | Auth0; the API still accepts Firebase tokens                                 | [ADR-0016](adr/ADR-0016-auth0-for-web-and-mcp.md), [RFC-0006](rfcs/RFC-0006-auth0-mcp-rollout.md)                                                          | Supabase Auth ([ADR-0021](adr/ADR-0021-supabase-auth-for-web-and-mcp.md)), not started                        |
| Web hosting         | Firebase Hosting                                                             | [ADR-0008](adr/ADR-0008-tag-triggered-release-to-hosting-and-cloud-run.md)                                                                                 | Cloudflare Pages ([ADR-0022](adr/ADR-0022-cloudflare-pages-and-api-proxy.md)), not started                    |
| API                 | Fastify on Cloud Run, `europe-west1`                                         | [ADR-0005](adr/ADR-0005-rest-api-validated-with-shared-zod-schemas.md), [ADR-0008](adr/ADR-0008-tag-triggered-release-to-hosting-and-cloud-run.md)         | Stays; a Cloudflare Worker proxy in front ([ADR-0022](adr/ADR-0022-cloudflare-pages-and-api-proxy.md))        |
| Domains             | Cloudflare DNS, DNS-only records                                             | [ADR-0015](adr/ADR-0015-cloudflare-dns-and-wally-custom-domains.md)                                                                                        | [ADR-0022](adr/ADR-0022-cloudflare-pages-and-api-proxy.md), not started                                       |
| Live updates        | None; the web app refetches with TanStack Query                              | [ADR-0006](adr/ADR-0006-server-state-in-tanstack-query-no-realtime.md)                                                                                     | Supabase Realtime ([ADR-0023](adr/ADR-0023-supabase-realtime-for-notification-events.md)), not started        |
| Assistant           | Core live: Ask, capture, suggestions, Tidy; Vertex models through the AI SDK | [RFC-0003](rfcs/RFC-0003-wally-agent.md), [RFC-0005](rfcs/RFC-0005-wallybot-inline.md), [ADR-0013](adr/ADR-0013-model-library-behind-an-owned-boundary.md) | Durable workers ([RFC-0010](rfcs/RFC-0010-durable-ai-workers.md)), not started                                |
| MCP                 | Live with reads and writes, account-wide connections                         | [RFC-0004](rfcs/RFC-0004-wally-mcp.md)                                                                                                                     | Supabase as the authorization server ([RFC-0012](rfcs/RFC-0012-supabase-auth-and-mcp.md))                     |

The [RFC index](rfcs/README.md) and the [ADR index](adr/README.md) give the status of every
document.

### Keeping the status true

- A pull request that builds, changes or removes what an RFC or ADR describes updates that
  document's row in its folder's index, in the same pull request.
- After a release deploys, update the **In production** cells that said "merged, not
  released", the release line above, and the "Last checked" line in each index.
- A document's own header records its decision. Where it stands in production lives only in
  the index, so there is one place to update.

## Kinds of documents

We loosely follow [Diátaxis](https://diataxis.fr/): keep how-to guides, reference and explanation as separate documents rather than mixing them. Architecture and ADRs are explanation. `SETUP.md` and `DEPLOY.md` are how-tos. `SPEC.md` is reference.

## Conventions

- Keep paragraphs short.
- Diagrams as [Mermaid](https://mermaid.js.org/) code blocks so they render on GitHub and diff cleanly.
- Link to code by relative path, and cite it by file and symbol, never by line number.
- Date things with ISO dates (`2026-10-12`).
- Prefix every document in a sequenced folder so the listing sorts in the order the documents were written:
  - RFCs are `rfcs/RFC-NNNN-short-kebab-title.md` and ADRs are `adr/ADR-NNNN-short-kebab-title.md`, each using the next free four-digit number in its folder. The prefix says which kind of document a file is wherever its name appears.
  - Research, plans and specs are `YYYY-MM-DD-short-kebab-title.md`.
  - A number or date, once assigned, never changes. Renaming breaks links from other branches.
- Delete or mark documents as outdated rather than leaving them silently wrong. An accepted ADR is superseded by a new ADR, never edited in place; see [`adr/README.md`](adr/README.md).

## What does not belong here

- `SETUP.md` holds working conventions for the code and tooling. The reasoning behind a convention belongs in an ADR, which `SETUP.md` links.
- Secrets, credentials, or personal data. Ever.

Platform migration (decided 2026-10-26): Wally moves to Supabase for data, identity and
notification events, and to Cloudflare for the web app and API edge. Firebase and Auth0
are then decommissioned. Start with [the platform RFC](rfcs/RFC-0011-platform-migration.md), then
the [data](rfcs/RFC-0008-firestore-to-supabase.md) and [identity and MCP](rfcs/RFC-0012-supabase-auth-and-mcp.md)
RFCs and ADRs [0020](adr/ADR-0020-supabase-postgres-through-the-api-with-drizzle.md) to
[0023](adr/ADR-0023-supabase-realtime-for-notification-events.md). The owner's
[stack brief](researches/2026-10-26-tech-stack-and-architecture.md) and the earlier
[provider research](researches/2026-10-19-provider-strategy.md) are dated references.
Nothing has been migrated yet.

Auth0 login and MCP, which currently serve production until the Supabase Auth cutover:
[rollout](rfcs/RFC-0006-auth0-mcp-rollout.md), [architecture and setup](AUTH0.md), [connection model](MCP_CONNECTION_MODEL.md), [card views](MCP_CARD_UI.md),
[decision](adr/ADR-0016-auth0-for-web-and-mcp.md), superseded
by [ADR-0021](adr/ADR-0021-supabase-auth-for-web-and-mcp.md).
