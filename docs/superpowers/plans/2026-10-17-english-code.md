# English Code Implementation Plan

> **Status:** executed in PR #51.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Steps 2 and 3 of ADR-0014: every German identifier in the code becomes English, sorting and key folding stop hardcoding German, and the unit tests, API tests, seed and E2E data read English. Persisted values (`HOCH`, `HEUTE`, `WEISS`, `wand`) are NOT touched here; they move in the expand release that follows (ADR-0014 step 4).

**Architecture:** Mechanical renames with the type checker and the test suites as the net. Three kinds of change, kept in separate commits so a reviewer can tell them apart: names (files, components, test ids, catalogue keys, map keys, comments), locale (sorting follows the person's language; the duplicate-key fold becomes locale-neutral), and test language (the unit tests render English by default with one German smoke test; API tests and the seed carry English data; the E2E specs carry English note titles while the E2E account keeps its German profile).

**Tech Stack:** TypeScript across `apps/api`, `apps/web`, `packages/shared`; Vitest; Playwright (parsed only, run in CI). No new dependency.

**Spec:** `docs/adr/0014-english-identifiers-and-persisted-values.md` (the decision and the value table), the audit at `/Users/mr_user/development/apps/wally-review/.superpowers/german-audit.md` (file:line for every finding; read-only, in another worktree), `docs/BRAND.md`, ADR-0007 (the catalogue decision, unchanged).

## Context

The owner's decision of 2026-10-17: no German identifiers or values in the code or the database; the app is bilingual and only the catalogues (and the German capture-parser word list) carry German. This plan is the code-only half. Rulings:

- **R1. Persisted values stay as they are in this PR.** `notePriorityValues`, `noteHorizonValues`, `noteColourValues`, `boardViewValues` and every place that reads or writes them keep `HOCH`, `HEUTE`, `WEISS`, `wand` until the expand release, because changing them needs the legacy map, the read normalisation and the migration (ADR-0014 steps 4–6). The catalogue keys `enums.*` and the CSS variables `--note-*` follow the values, so they also wait. Cost if wrong: nothing; the next PR does them.
- **R2. The E2E account keeps its German profile.** A signed-in user's language comes from the profile, not the browser, so switching the Playwright locale alone would change nothing, and switching the stored profile is a data change on the shared E2E account. The specs keep asserting the German UI, which is the product's default language (SPEC §12), and their note titles and test data become English. Cost if wrong: a later PR flips the profile and the assertions together.
- **R3. Unit tests render English by default.** `test/setup.ts` initialises i18n with `en`; assertions move to the English catalogue; `englishSurface.test.tsx` becomes `germanSurface.test.tsx`, the German smoke test, so both catalogues still reach the screen. The capture parser's German cases stay German, since they test German parsing. Cost if wrong: one setting and the smoke test flip back.
- **R4. The duplicate-key fold becomes locale-neutral** (`toLowerCase()` instead of `toLocaleLowerCase('de')`): for German and English letters the two folds agree, so no stored key changes meaning; a test pins `Kunde`/`kunde`/`KUNDE` as one key and `Straße`/`STRASSE` as two, before and after. Sorting of keys, values and tags follows the person's UI language on the web (`useLanguage`) and the profile language in the API. Cost if wrong: an ordering difference between two languages, which is the intended behaviour.
- **R5. Seed data becomes English** (titles, subtasks, tags, property keys `Kunde`/`Vertrag`/`Schaden` to `Customer`/`Contract`/`Claim`, document ids), while its enum values stay German per R1 and its users keep `language: 'de'` because the seed users are German-profile demo users. The E2E README's "Meine Wand" note stands (R2).
- **R6. Historical plans under `docs/superpowers/plans/` are not rewritten.** They are the record of their time.

## Global Constraints

- Work only in `/Users/mr_user/development/apps/wally-english`, branch `feat/english-code` (cut from `origin/main` at the merge of #49; base `main`; never stacked). Never run git or edit files in `/Users/mr_user/development/apps/wally` (bind-mounted into the running stack) or in any other worktree.
- API route tests need the Firestore emulator on `localhost:8080` and run ONE FILE AT A TIME: `cd /Users/mr_user/development/apps/wally-english/apps/api && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=wally-local CORS_ORIGIN=http://localhost:5173 pnpm vitest run test/<file>`. Never two emulator runs at once, never the whole API suite in one command, never any docker command. Unit tests under `apps/api/src` need no emulator.
- Web tests touch no emulator: `cd /Users/mr_user/development/apps/wally-english/apps/web && pnpm vitest run <file>`, one file at a time while iterating; the whole web suite once at the end of each task that touches it.
- Checks from the worktree root: `pnpm --filter @wally/shared build`, `pnpm --filter @wally/api typecheck`, `pnpm --filter @wally/api lint`, `pnpm --filter @wally/web typecheck`, `pnpm --filter @wally/web lint`, `pnpm format:check` (fix with `pnpm format`). Guard tests stay green: `apps/api/src/lib/assistant/model/boundary.test.ts`, `apps/web/src/brandGuards.test.ts`, `src/i18n/noHardcodedCopy.test.ts`, `src/i18n/resources.test.ts`, the surface smoke test, `src/features/board/WallView/NoteCard.test.tsx` after the rename.
- No new dependency. No change to any persisted value or to the shared enum value arrays (R1). Copy only from the catalogues; the catalogue VALUES in `de.ts` stay German.
- Git renames with `git mv` so history follows the files.
- Conventional Commits; never commit to `main`. Commit with `git -c core.hooksPath=/dev/null commit`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the model that wrote them, as the workflow names it).
- Prettier: single quotes, trailing commas, width 100.

## Review Focus

1. After the rename, `grep -rn "Wand" apps/*/src packages/shared/src apps/web/e2e --include=*.ts --include=*.tsx` finds only catalogue values in `de.ts`, the German default board name, the E2E assertions on German labels, and nothing else: no identifier, file, test id, comment or catalogue key. Test in Task 1 (a guard test that greps the source tree).
2. The duplicate-key rule is unchanged: `Kunde`, `kunde` and `KUNDE` are one property; `Straße` and `STRASSE` are two; a filter `?field=kunde` still matches `Kunde`. Tests in Task 2 (shared, API query, web helpers).
3. Sorting follows the language: with an English UI, property keys sort with `localeCompare(…, 'en')`; with German, `'de'`; the API's tag list sorts by the caller's profile language. Tests in Task 2.
4. The English unit-test surface asserts English copy everywhere a German string was asserted before, and the German smoke test renders the German catalogue on screen. Tests in Task 3.
5. No E2E spec breaks: the account stays German, the titles become English, and every selector still matches. Verified in CI, parsed locally with `playwright test --list`. Task 5.

---

### Task 1: Names

**Files:** (every one found by the audit, B.1–B.4, B.7, B.9, B.11, B.12)

- Rename (git mv): `apps/web/src/features/board/WandView/` → `WallView/` with its eight files; `WandView.tsx` → `WallView.tsx`; `WandCanvas.tsx` → `WallCanvas.tsx`; their tests.
- Modify: every importer of those paths (`AppShell.tsx`, `ListView`, `Capture/*`, tests, `brandGuards.test.ts`), `useCaptureSession.test.tsx`, `WallCanvas.tsx` (`data-testid="wall-canvas"`), `noteDerived.ts` (`'ALLE'` → `'ALL'`), `de.ts`/`en.ts` (`board.topBar.view.wand` → `view.wall`) and `TopBar.tsx`, the "Frei mode" / "Wand" / "Liste" / "Horizont" comments in `WallCanvas.tsx`, `WallView.tsx`, `ZoneBands.tsx`, `packages/shared/src/constants.ts`, `components/ui/segmented.tsx`, the `brandGuards.test.ts` comment about `Wand`, `packages/shared/src/enums.ts` comments that call the enums "German domain vocabulary" (reword to say the values are migrated per ADR-0014; the arrays themselves do not change), `docs/BRAND.md` (nothing left to change; verify), `docs/SPEC.md` and `docs/architecture/*` references to `WandView`.
- Create: `apps/web/src/englishIdentifiers.test.ts`, a guard like `brandGuards.test.ts`: reads every `.ts`/`.tsx` under `apps/web/src` except `i18n/de.ts` and `lib/capture/parseCapture.ts`, and fails on any identifier, path, test id or comment containing `Wand`, `Frei`, `Liste`, `Horizont`, `ALLE`, `wand-` (lowercase `wand` in `'wand'` string literals is allowed until the expand release and listed in the test's allow-list with a pointer to ADR-0014 step 4). Also checks `apps/api/src` and `packages/shared/src` through relative paths.

- [ ] Steps: write the guard test (RED), do the renames with `git mv`, fix imports with the type checker, run the guard (GREEN), `NoteCard.test.tsx` (now under `WallView/`), `WallView.test.tsx`, `WallCanvas.test.tsx`, `useCaptureSession.test.tsx`, `brandGuards`, `resources`, `noHardcodedCopy`; then the whole web suite; then the checks. Commit: `refactor(web): WallView, WallCanvas and the last German names; a guard keeps them English`.

### Task 2: Locale

**Files:** `packages/shared/src/schemas/customField.ts` (`findFieldKey`, the `superRefine` fold, its comment), `apps/api/src/lib/commands/queries.ts` (`?field=` fold, `listTags` sort), `apps/api/src/lib/assistant/suggestions.ts` (`collectKeys` fold and sort), `apps/web/src/features/board/util/noteDerived.ts` (folds and sorts in `collectFieldKeys`, `collectFieldValues`, `filterNotes`), `apps/web/src/features/board/ListView/NoteRow.tsx` and `NoteDetail/CustomFieldEditor.tsx` (sorts), the route that calls `listTags` (pass `userLanguage(request.user)`), tests beside each.

- Fold: `toLocaleLowerCase('de')` → `toLowerCase()`, comment rewritten: locale-neutral on purpose, the same for every caller, with the `Kunde`/`Straße` cases pinned in `customField.test.ts` (create under `packages/shared` only if a runner exists there; otherwise in `apps/api/src/lib/commands/queries.test.ts` or the web helper tests).
- Sort: web helpers take a `language` argument (callers pass `useLanguage().language`; `noteDerived` functions get it as a parameter with tests for `'de'` and `'en'` ordering of `Ärger`/`Zebra`); API `listTags(db, actor, boardId, language)` and `collectKeys(notes, language)`.

- [ ] Steps: failing tests first (fold cases, sort cases, the `?field=` filter case in `test/notes.test.ts` or the existing field-filter test), implement, run each file, the checks. Commit: `refactor: sorting follows the person's language; the property-key fold is locale-neutral`.

### Task 3: Web unit tests in English

**Files:** `apps/web/src/test/setup.ts` (`lng: 'en'`, reset to `'en'`), every `*.test.tsx` under `apps/web/src` that asserts German copy or carries German test data (the audit's §D list: `InlineCaptureCard.test.tsx` 80 lines, `NoteDetailPanel.test.tsx` 77, `AssistantContent.test.tsx` 47, `ListView.test.tsx` 40, `PendingReview.test.tsx` 39, `useCaptureSession.test.tsx` 34, `BoardHome.test.tsx` 32, `usePendingFor.test.tsx` 25, `NoteCard.test.tsx` 23, and the rest found by `grep -l` for umlauts and the German words listed in the audit), `apps/web/src/test/fixtures.ts` (`'Meine Wand'` → `'My Board'`, `reason: 'Freitag'` → `'Friday'`, titles), `apps/web/src/i18n/englishSurface.test.tsx` → `germanSurface.test.tsx` (renders German after `changeLanguage('de')`, same assertions mirrored).

- Keep German: `apps/web/src/lib/capture/parseCapture.test.ts` and the German parsing cases in `InlineCaptureCard.test.tsx` (mark them with a one-line comment "German input: the parser is bilingual").
- Rule for every assertion: look up the key in `de.ts`, read the English value from `en.ts`, assert that. Test data (titles, names, property keys) becomes natural English. Never weaken an assertion; a test that cannot be expressed in English is a finding, not a deletion.

- [ ] Steps: flip `setup.ts`, run the whole web suite once to list the failures, fix file by file (one `vitest run <file>` each), add `germanSurface.test.tsx`, run the suite, the guards, the checks. Commit in two: `test(web): the unit tests render English; German keeps a smoke test` and `test(web): English test data`.

### Task 4: API tests and the seed in English

**Files:** `apps/api/test/*.test.ts` with German data (`notes.test.ts` `'Testnotiz'`, `assistant-suggestions.test.ts` 70 lines, `assistant-turns.test.ts`, `runTurn.test.ts` `'MARKER-Mueller-anrufen'`, others per the audit), `apps/api/src/seed.ts` (titles, subtasks, tags, property keys `Kunde`/`Vertrag`/`Schaden` → `Customer`/`Contract`/`Claim`, ids `seed-note-…` in English; enum values unchanged per R1; `language: 'de'` unchanged per R5), `apps/api/test/helpers.ts` (fixture names), `apps/api/src/lib/assistant/capturePrompt.ts` examples (`Kunde: Müller GmbH` → `Customer: Müller GmbH`, keep the German trigger words; update `capturePrompt.test.ts`).

- The fake runners in the route tests key on titles (`'all'`, `'review'`, `'fail'`); those keys are already English. The German reasons (`'Freitag'`, `'dringend'`) become `'Friday'`, `'urgent'` where they are data, and stay where they test the parser's German.

- [ ] Steps: edit, run each changed route file alone with the emulator, the API unit tests, the checks. Commit: `test(api): English test data and seed`.

### Task 5: E2E note titles and the docs

**Files:** `apps/web/e2e/*.spec.ts` (test data only: `E2E-Notiz` → `E2E note`, `Lifecycle-Test` → `Lifecycle test`, `Horizont-Test` → `Horizon test`, `E2E-Privat` → `E2E private`, subtask `'Erster Schritt'` → `'First step'`; the German label selectors stay, per R2), `apps/web/e2e/README.md` (one sentence: the account's UI is German; test data is English), `docs/architecture/overview.md` and `docs/SPEC.md` where they name `WandView`, `README.md` E2E paragraph if any.

- [ ] Steps: edit, `cd apps/web && pnpm exec playwright test --list`, `pnpm format:check`. Commit: `test(e2e): English note titles; the account's UI stays German`.

---

## Self-review

- Spec coverage: ADR-0014 steps 2 (Task 1, 2) and 3 (Tasks 3, 4, 5); step 4 onward deliberately out (R1).
- Placeholders: the tasks describe transformations with rules and the audit's file list rather than full code, because the change is a rename and a rewrite of assertions; each task names its tests and its commit.
- Type consistency: `language` parameters are the shared `Language` type; `listTags`'s new argument is used by its one route.
- Review Focus: 1 → Task 1's guard; 2, 3 → Task 2; 4 → Task 3; 5 → Task 5 and CI.
