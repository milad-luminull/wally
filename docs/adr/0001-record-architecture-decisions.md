# ADR-0001: Record architecture decisions as ADRs

- **Status:** accepted
- **Date:** 2026-10-12
- **Deciders:** Milad Rezazadeh

## Context and problem statement

Wally is small, but its main decisions are already hard to reverse: the data store, the auth model, the deploy path. Until now the reasoning behind them lived in five places at once: the change triggers in [`SETUP.md`](../SETUP.md), the "Deploying" section of the root README, the "why" subsections of [`DEPLOY.md`](../DEPLOY.md), long code comments, and commit bodies. The biggest decision, replacing PostgreSQL with Firestore, is explained in none of the commit messages that made it. How should the project record a decision so that the reason survives the next refactor?

## Considered options

1. **Architecture Decision Records in `docs/adr/`:** good, because one file per decision, numbered, next to the code and reviewed with it; bad, because it is one more thing to write.
2. **Keep rationale in `SETUP.md` change triggers and code comments:** good, because it is where readers already look; bad, because a comment moves or dies with the code it sits on, and a change trigger states the rule without the alternatives that were rejected.
3. **A wiki or Notion page outside the repository:** good, because it is easy to edit; bad, because it drifts from the code and is invisible in a pull request.

## Decision outcome

Chosen option: **ADRs in `docs/adr/`**, in the trimmed [MADR](https://adr.github.io/madr/) format described in [`README.md`](README.md), with the template in [`0000-template.md`](0000-template.md). The same convention is used in the sibling phoenix repository, so a reader moving between the two finds the same shape.

- An ADR is written when a decision is hard to reverse, changes stored data, or picks between real alternatives.
- An accepted ADR is never edited; it is superseded by a new one.
- The rules that follow from a decision stay in `SETUP.md`, `BRAND.md` or `DEPLOY.md`, which link the ADR. The ADR holds the why.
- ADR-0002 to ADR-0009 were written retroactively on 2026-10-12, dated with the commit that made each decision, from the code and commit bodies as they stand today.

### Consequences

- Good: the reason for a decision has one home and survives refactors.
- Good: a pull request that changes a decision has to say so, by superseding an ADR.
- Bad: another document to keep honest. A decision made without an ADR is still a decision; the index must be kept current in review.
- Neutral: the existing change triggers in `SETUP.md` stay where they are and now point at the ADR behind them.

### Confirmation

The pull request template asks whether a decision that is hard to reverse has an ADR. There is no automated check.

## More information

- [Documenting architecture decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), Michael Nygard, and the [MADR](https://adr.github.io/madr/) template this format trims.
- Where documents go: [`docs/README.md`](../README.md).
