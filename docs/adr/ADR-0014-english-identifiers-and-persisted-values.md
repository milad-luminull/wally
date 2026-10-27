# ADR-0014: English identifiers and persisted values, migrated in place

- **Status:** accepted; its migration steps (expand, migrate, contract) are superseded by [ADR-0024](ADR-0024-rename-persisted-values-without-migration.md)
- **Date:** 2026-10-17
- **Deciders:** Milad Rezazadeh
- **Supersedes:** the context sentence of [ADR-0007](ADR-0007-ui-text-in-bundled-i18next-catalogues.md) ("Wally's domain language is German …") and the sentence in [`BRAND.md`](../BRAND.md) that the persisted colour keys never change

## Context and problem statement

Wally is bilingual: every word a person sees comes from the German or the English catalogue
(ADR-0007). The code and the data model underneath are shared by both languages, and they are
German-first: the values stored on every note for priority (`HOCH`, `MITTEL`, `NIEDRIG`),
horizon (`HEUTE`, `DIESE_WOCHE`, `SPAETER`) and colour (`WEISS`, `EIS`, `SAND`, `MINZE`,
`HIMMEL`, `NEBEL`, `BUTTER`, `LEHM`, `ROSE`, `MALVE`, `FLIEDER`, `SEEGRUEN`, `SALBEI`, `OLIV`),
the saved board view `wand`, the components `WandView` and `WandCanvas`, the CSS variables
`--note-weiss` and the rest, a hardcoded `'de'` in sorting and key folding, and most test and
seed data. An audit on 2026-10-17 counted 20 persisted enum values with 451 uses, 12 German
identifiers with about 180 uses, 14 hardcoded locale choices, and German test data in 75 files.
Field names, collection names, routes, error codes and every other enum are already English.

The owner's decision on 2026-10-17: no German identifiers or values anywhere in the code or the
database. The catalogue values in `de.ts`, the German word list of the capture parser, the
German default board name "Meine Wand" for German profiles and the German default language of
`SPEC.md` §12 are localization and product choices, and stay.

Two documents promised the opposite and are superseded by this record: ADR-0007's context and
`BRAND.md`'s "persisted keys never change, so nothing migrates in Firestore".

## Decision drivers

- One language in code and data, read by every contributor and by the model boundary, with the
  user's language only in the catalogues.
- The persisted values are checked by Zod on every API response: after a rename, one document
  still holding an old value fails the read of its whole board. The change must never put the
  data and the code out of step.
- The emulator holds the owner's real board in memory with no export; production Firestore holds
  live boards. Nothing may be rewritten without a backup, and nothing may require stopping the
  API.
- Old bundles stay open in tabs after a deploy, and links carry `?view=wand&priority=HOCH`.

## Considered options

1. **Rename in code and data in one release, with a one-off script while the API is stopped:**
   good, because one change; bad, because Cloud Run has no stopped state without an outage, open
   tabs would send old values and get 400s, and a document the script misses makes its board
   answer 500.
2. **Keep the stored values German and translate only the code names:** good, because no data is
   touched; bad, because the database stays German, which is what the owner asked to end, and
   every new reader keeps a map in their head.
3. **Expand, migrate, contract: accept both spellings for one release, write only English,
   rewrite the stored documents in place with the API up, then drop the old spellings:** good,
   because the stored form is invisible to clients during the migration, no downtime, old tabs
   and links keep working, a partial migration is safe; bad, because two releases and a legacy
   map that lives for a while.

## Decision

Option 3, with these values and names:

| Set                                              | Old                                                                                                                               | New                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Priority                                         | `HOCH`, `MITTEL`, `NIEDRIG`                                                                                                       | `HIGH`, `MEDIUM`, `LOW`                                                                                                                                                                                                                                                                                                                         |
| Horizon                                          | `HEUTE`, `DIESE_WOCHE`, `SPAETER`                                                                                                 | `TODAY`, `THIS_WEEK`, `LATER`                                                                                                                                                                                                                                                                                                                   |
| Colour                                           | `WEISS`, `EIS`, `SAND`, `MINZE`, `HIMMEL`, `NEBEL`, `BUTTER`, `LEHM`, `ROSE`, `MALVE`, `FLIEDER`, `SEEGRUEN`, `SALBEI`, `OLIV`    | `CHALK`, `ICE`, `STONE`, `MINT`, `SKY`, `MIST`, `OAT`, `CLAY`, `ROSE`, `MALLOW`, `HEATHER`, `SEA_GREEN`, `SAGE`, `OLIVE` (the English labels, so key and label say the same thing)                                                                                                                                                              |
| Board view                                       | `wand`                                                                                                                            | `wall`                                                                                                                                                                                                                                                                                                                                          |
| Components, files, CSS, test ids, catalogue keys | `WandView`, `WandCanvas`, `wand-canvas`, `--note-weiss` …, `enums.colour.WEISS` …, `board.topBar.view.wand`, the group key `ALLE` | `WallView`, `WallCanvas`, `wall-canvas`, `--note-chalk` …, `enums.colour.CHALK` …, `board.topBar.view.wall`, `ALL`                                                                                                                                                                                                                              |
| Locale in code                                   | `localeCompare(…, 'de')`, `toLocaleLowerCase('de')`                                                                               | sorting follows the person's UI language on the web and the profile language in the API; the case fold for duplicate property keys becomes locale-neutral (`toLowerCase()`), which folds German and English letters the same way                                                                                                                |
| Tests, E2E, seed                                 | German titles, labels and assertions                                                                                              | English, with the unit tests running in English; the E2E account's profile stays German until a later PR flips the profile and the label selectors together, so the specs assert the German UI with English test data; the German capture-parser tests and one German-surface smoke test stay German, as `germanSurface.test.tsx` covers German |

Not changed: `INITIAL_BOARD_NAME.de = 'Meine Wand'` (user content, created once per account
and never rewritten), `DEFAULT_LANGUAGE = 'de'` (`SPEC.md` §12), the catalogue values, the
parser's German word list, `untitled.ts`'s German label.

### The three steps

1. **Expand (release N).** `@wally/shared` carries the English values and a legacy map (old
   spelling to new). The API normalises on every read boundary: the note DTO, user preferences,
   the suggestion DTO and receipt replay. It accepts old spellings on input through the shared
   schemas, writes and returns only English. The web reads only English. The model-facing tool
   schema and the capture prompt use the English values.
2. **Migrate.** An idempotent `--migrate-enums` mode of the existing maintenance command rewrites
   notes (`priority`, `horizon`, `colour`), move history (`metadata.from`, `metadata.to`), user
   preferences (`view`, the priority filter), assistant suggestions and stored receipts, in
   batches, reporting counts per path, with the API up. Dry run first; then `--apply`; then the
   dry run again until it reports zero. In the emulator first, after an export of the running
   emulator copied out of the container, without restarting it; then in production, after a
   backup the owner confirms (a managed Firestore export, or point-in-time recovery switched on,
   both documented GCP features; which one this project has is not verified by this record).
   The owner runs the production command.
3. **Contract (release N+1).** Once the dry run reports zero and the 7-day receipt and 30-day
   conversation retention windows have passed, the legacy map and the input preprocessing go.

One known edge: a write sent before release N and retried after it computes a different
idempotency fingerprint, because the fingerprint covers the parsed command, and is refused with
`409 IDEMPOTENCY_KEY_REUSED`. It is rare (retries inside a seven-day window) and accepted.

### Order of pull requests

1. This record (docs only).
2. Code-only renames: components, files, test ids, the `ALL` key, the locale choices.
3. Tests, E2E and seed in English, verified in CI.
4. Expand: the values, the legacy map, the read boundaries, every reader, the catalogue keys and
   CSS variables, the prompt and the tool schema. Tagged and released.
5. The migration mode, run in the emulator, then in production.
6. Contract.

## Consequences

- Good: one language in code and data; a new contributor or the model boundary never meets a
  German token outside a catalogue.
- Good: no downtime and no 500 on a half-migrated board, because the stored form is hidden
  behind the API for one release.
- Bad: two releases and a legacy map for a few weeks; a byte change in the capture prompt
  invalidates the provider's prompt cache once.
- Bad: every historical plan under `docs/superpowers/plans/` keeps the old values; they are the
  record of their time and are not rewritten.

## Confirmation

- A test in `@wally/shared` maps every old value to its new one and back.
- The API test suite creates a note with old values through the legacy path and reads it back
  in English; a preferences document with `view: 'wand'` reads back as `wall`.
- The migration's dry run on a fixture with every old value reports each path's count, and a
  second `--apply` reports zero.
- `grep -w` for every old value over `apps/*/src`, `packages/shared/src`, `apps/web/e2e` finds
  nothing after step 6, except the legacy map until then and the historical plans always.
