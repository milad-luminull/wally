# Documentation

Technical documentation for Wally. Everything here is Markdown, lives next to the code, and is reviewed in the same pull request as the change it describes.

## Where things go

| What                          | Where                                                  | Notes                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture                  | [`architecture/overview.md`](architecture/overview.md) | System context, containers, the data model and the boundaries between them. C4-style diagrams in Mermaid.                                                                                                                                                                                                                                         |
| Architecture Decision Records | [`adr/`](adr/)                                         | One file per decision that is hard to reverse. See [`adr/README.md`](adr/README.md) for the process.                                                                                                                                                                                                                                              |
| Product requirements          | [`SPEC.md`](SPEC.md)                                   | What the app does, mode by mode.                                                                                                                                                                                                                                                                                                                  |
| Setup and working conventions | [`SETUP.md`](SETUP.md), [`RULE.md`](RULE.md)           | Monorepo layout, stack, commands, test policy, definition of done.                                                                                                                                                                                                                                                                                |
| Deploying and operating       | [`DEPLOY.md`](DEPLOY.md)                               | Firebase Hosting, Cloud Run, Firestore, the release workflow and rollback.                                                                                                                                                                                                                                                                        |
| Standards                     | [`BRAND.md`](BRAND.md), [`GDPR.md`](GDPR.md)           | Visual identity and voice; data inventory and open obligations.                                                                                                                                                                                                                                                                                   |
| Proposals                     | [`rfcs/`](rfcs/)                                       | Designs under discussion that are not yet decided: the in-app assistant ([`WALLY_AGENT.md`](rfcs/WALLY_AGENT.md)), writing in place with Wallybot ([`WALLYBOT_INLINE.md`](rfcs/WALLYBOT_INLINE.md)) and MCP access ([`WALLY_MCP.md`](rfcs/WALLY_MCP.md)). Accepted proposals stay here for their reasoning; their requirements live in `SPEC.md`. |

The root [`README.md`](../README.md) covers how to run, test and deploy the app.

## Kinds of documents

We loosely follow [Diátaxis](https://diataxis.fr/): keep how-to guides, reference and explanation as separate documents rather than mixing them. Architecture and ADRs are explanation. `SETUP.md` and `DEPLOY.md` are how-tos. `SPEC.md` is reference.

## Conventions

- Keep paragraphs short.
- Diagrams as [Mermaid](https://mermaid.js.org/) code blocks so they render on GitHub and diff cleanly.
- Link to code by relative path, and cite it by file and symbol, never by line number.
- Date things with ISO dates (`2026-10-12`).
- Delete or mark documents as outdated rather than leaving them silently wrong. An accepted ADR is superseded by a new ADR, never edited in place; see [`adr/README.md`](adr/README.md).

## What does not belong here

- `SETUP.md` holds working conventions for the code and tooling. The reasoning behind a convention belongs in an ADR, which `SETUP.md` links.
- Secrets, credentials, or personal data. Ever.
