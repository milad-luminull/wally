# RFCs

An RFC describes a feature or a change to the platform: the problem, the requirements and
the plan. The decisions it leads to are recorded as [ADRs](../adr/README.md).

This index is the one place that says where each RFC stands. A document's own header
records its decision; the **In production** column below is kept true by the pull request
that changes it (see [Keeping the status true](../README.md#keeping-the-status-true)).

Last checked against the code on 2026-10-27, at `main` e72dd429. Production runs **v0.11.0**.

## Index

| RFC                                                | Title                                         | Decision                              | In production                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [RFC-0001](RFC-0001-private-notes.md)              | Private notes                                 | accepted                              | **live** since v0.4.0                                                                                                              |
| [RFC-0002](RFC-0002-board-home.md)                 | Board home and multiple boards                | accepted                              | **live** since v0.4.0                                                                                                              |
| [RFC-0003](RFC-0003-wally-agent.md)                | Wally assistant                               | accepted                              | **partly live** since v0.5.0. Not built: own provider keys and model choice, multi-item capture, general approved write turns (§6) |
| [RFC-0004](RFC-0004-wally-mcp.md)                  | Wally over MCP                                | accepted                              | **live** since v0.8.3, reads and writes. Not built: the coverage gaps in §3 (board create and rename, delete, history and others)  |
| [RFC-0005](RFC-0005-wallybot-inline.md)            | Wallybot inline                               | accepted                              | **live**; the full set since v0.6.0                                                                                                |
| [RFC-0006](RFC-0006-auth0-mcp-rollout.md)          | Auth0 login and first MCP release             | superseded by RFC-0012                | **live** since v0.8.3. Still serves production until RFC-0012 is built. The one-off Auth0 import was removed in v0.10.1            |
| [RFC-0007](RFC-0007-eu-platform-and-ai-workers.md) | EU platform and durable AI workers            | superseded by RFC-0011                | never built                                                                                                                        |
| [RFC-0008](RFC-0008-firestore-to-supabase.md)      | Firestore to Supabase                         | accepted                              | not built                                                                                                                          |
| [RFC-0009](RFC-0009-uploads-and-retrieval.md)      | Private uploads and document retrieval        | proposed                              | not built                                                                                                                          |
| [RFC-0010](RFC-0010-durable-ai-workers.md)         | Durable AI workers                            | accepted, as workstream 5 of RFC-0011 | not built                                                                                                                          |
| [RFC-0011](RFC-0011-platform-migration.md)         | Platform migration to Supabase and Cloudflare | accepted                              | not built; no workstream has started                                                                                               |
| [RFC-0012](RFC-0012-supabase-auth-and-mcp.md)      | Identity and MCP on Supabase Auth             | accepted                              | not built                                                                                                                          |

## Statuses

**Decision**

| Value                 | Meaning                                                     |
| --------------------- | ----------------------------------------------------------- |
| `proposed`            | Written, not yet agreed by the owner.                       |
| `accepted`            | Agreed; the plan to build.                                  |
| `rejected`            | Considered and turned down. The RFC stays, with the reason. |
| `withdrawn`           | Dropped by its author before a decision.                    |
| `superseded by RFC-N` | Replaced by a later RFC.                                    |

**In production** means what runs on `wally.luminull.com` and `api.wally.luminull.com`,
named by the first release that deployed it. A release whose deployment failed does not
count.

| Value                 | Meaning                                                |
| --------------------- | ------------------------------------------------------ |
| **live** since vX.Y.Z | Built and deployed.                                    |
| **partly live**       | Some of it is deployed; the row names what is missing. |
| merged, not released  | On `main`, not yet in a deployed release.              |
| not built             | No code.                                               |
| removed in vX.Y.Z     | Was live, then deleted.                                |

A superseded RFC can still be **live**: the decision changed, but the replacement is not
built yet, so the old design is what users get.

## Adding an RFC

Name it `RFC-NNNN-short-kebab-title.md` with the next free number, start its header with
`Status: proposed`, and add a row here in the same pull request.
