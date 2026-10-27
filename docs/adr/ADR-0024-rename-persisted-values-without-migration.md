# ADR-0024: Rename the persisted values in one release and reset the data

- **Status:** accepted
- **Date:** 2026-10-27
- **Deciders:** Milad Rezazadeh
- **Supersedes:** the migration steps (expand, migrate, contract) of
  [ADR-0014](ADR-0014-english-identifiers-and-persisted-values.md); its values and names stand

## Context and problem statement

ADR-0014 renamed the stored priority, horizon, colour and board-view values to English
(`HOCH` to `HIGH`, `wand` to `wall` and the rest) in three steps: an expand release that
accepts both spellings through a legacy map and normalises every read, an in-place migration
with a backup and the API up, and a contract release weeks later, once the receipt and
conversation retention windows have passed. The identifier rename is live since v0.5.0; the
stored values are still German.

On 2026-10-27 the owner judged that no stored data was worth keeping, neither in production
(database `wally` in project `luminull-wally`) nor in the local emulator. The question is
whether the value rename still needs the expand, migrate and contract steps.

## Considered options

1. **ADR-0014's expand, migrate, contract:** good, because every board, account and
   connection survives and old tabs keep working; bad, because two releases, a legacy map,
   a migration mode with a backup, and a 30-day wait before the old spellings can go.
2. **Rename in one release and delete all Firestore data:** good, because one change with no
   legacy code; bad, because every board, account record and connection is lost.

## Decision outcome

Chosen option: **option 2**, because the one thing option 1 buys, keeping the data, has no
value here. The values are those of ADR-0014. After the release an old spelling is invalid
like any other unknown value: the shared schemas stay plain enums, with no legacy map, no read
normalisation and no migration mode. The owner deletes every document in the production
database right after the release deploys, and restarts the local emulator empty; the steps
are in [`DEPLOY.md`](../DEPLOY.md#release-with-a-data-reset-adr-0024).

### Consequences

- Good: one release; no legacy map, migration code or contract step; the code and the data
  hold one spelling from the first write.
- Bad: everyone starts from an empty board.
- Bad: accounts are re-provisioned on the next sign-in with new Wally user ids, which needs
  `AUTH0_SIGNUP_ENABLED=true` at release time; the Auth0 identities themselves are untouched.
- Bad: connected MCP apps must reconnect.
- Bad: this month's assistant spend and usage counters restart from zero.
- Bad: an open tab or any other client still sending an old value gets 400 until it reloads,
  and a stale link with `?view=wand&priority=HOCH` opens the board without that filter.
- Bad: an open tab on the old bundle cannot read English data either, since it validates
  every response against its own German schemas, so each read fails until it reloads.
- Bad: between the deploy and the delete, an existing board answers 500, because its
  German-valued documents fail the response schema.
- Bad: once English data is written, rolling back to a release with German values is not
  possible; the fix is forward.
- Neutral: the owner runs the reset by hand; the runbook is in `DEPLOY.md`.

### Confirmation

`apps/web/src/englishValues.test.ts` fails on any old spelling in the code, scripts,
workflows and Firestore configuration, except in the refusal tests that must spell one.

## More information

- [ADR-0014](ADR-0014-english-identifiers-and-persisted-values.md): the value table and names
  this record keeps.
- [`DEPLOY.md`, "Release with a data reset"](../DEPLOY.md#release-with-a-data-reset-adr-0024):
  the production and emulator steps.
- The plan: [`2026-10-27-english-values.md`](../superpowers/plans/2026-10-27-english-values.md).
