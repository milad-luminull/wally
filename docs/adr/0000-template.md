# ADR-NNNN: Short title that names the decision

<!--
Budget: about one page (300 to 600 words), readable in five minutes. Two pages only for a hard trade-off.
Write Context and Decision outcome as prose. Delete optional sections you do not use.
Does not belong here; put it in its own document and link it from More information:
- Rule details, naming conventions, request and response examples: a guide such as docs/SETUP.md or docs/BRAND.md.
- Commands, rollout order, operational steps: docs/DEPLOY.md.
- Code maps, directory trees, file-by-file detail: docs/architecture/overview.md or the root README.
Cite code by file path and symbol, never by line number.
Once accepted, only the status, a "superseded by" link and typo fixes change. A new decision needs a new ADR.
-->

- **Status:** proposed <!-- proposed | accepted | rejected | deprecated | superseded by ADR-NNNN -->
- **Date:** YYYY-MM-DD
- **Deciders:** names or team
- **Supersedes:** ADR-NNNN (if any)

## Context and problem statement

Two or three sentences: the forces at play, the scope, and the question being decided. Stay neutral. Link the issue or incident that led here.

## Decision drivers

<!-- Optional. Delete it when the context already states the drivers. -->

- Driver 1, e.g. must work on the CI runner without extra setup
- Driver 2

## Considered options

<!-- One line per option with its main pro and con. Add a "Pros and cons of the options" section, before More information, only for a hard trade-off. -->

1. **Option A:** good, because ...; bad, because ...
2. **Option B:** good, because ...; bad, because ...

## Decision outcome

Chosen option: **Option A**, because it best satisfies the drivers above. If the decision sets rules, state each in one line and link the guide that holds the detail.

### Consequences

- Good: what becomes easier.
- Bad: what becomes harder, and what we accept. <!-- At least one. -->
- Neutral: follow-up work this creates.

### Confirmation

<!-- Optional. How compliance is checked: a CI check, a test, a lint rule or review. -->

## More information

<!-- Optional. Links to the guide or design doc, related or superseded ADRs, a re-evaluation trigger. -->
