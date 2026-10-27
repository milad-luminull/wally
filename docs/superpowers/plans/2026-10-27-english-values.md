# English Values Implementation Plan

> **Status:** executed on branch feat/english-values.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every persisted value to English in one release (`HIGH`, `TODAY`, `CHALK`, `wall` …), with no legacy spellings, no read normalisation and no migration, because the owner deletes all Firestore data (production and the local emulator) at the release; record that choice as ADR-0024.

**Architecture:** A straight rename. The value arrays in `@wally/shared` become English and stay plain `z.enum`s, so an old spelling is invalid like any other unknown value (400 on input, a failed parse on read). Every literal, prompt, model and MCP schema, catalogue key, CSS variable and landing slug follows. Correctness rests on the type checker, the existing suites, a guard test that fails on any old spelling in the code, and the empty database the release starts from.

**Tech Stack:** TypeScript across `apps/api`, `apps/web`, `packages/shared`; Zod 3; Vitest; Playwright (parsed locally, run in CI). No new dependency.

**Spec:** the owner's decision of 2026-10-27 (one release; all Firestore data deleted; nothing to migrate), recorded by Task 5 as `docs/adr/ADR-0024-rename-persisted-values-without-migration.md`; the value table and names of `docs/adr/ADR-0014-english-identifiers-and-persisted-values.md`, whose expand/migrate/contract steps ADR-0024 supersedes. Model plan for format and constraints: `docs/superpowers/plans/2026-10-17-english-code.md` (ADR-0014 steps 2 and 3, PR #51).

## Context

### Where the values live (inventory of 2026-10-27 at `main` 157bca44)

Persisted, all deleted by the owner at the release, so none is migrated or normalised:

| Firestore path                              | Field(s)                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `notes/{noteId}`                            | `priority`, `horizon`, `colour`                                                      |
| `notes/{noteId}/history/{eventId}`          | `metadata.from`, `metadata.to` of `MOVED` events with `mode` `HORIZON` or `PRIORITY` |
| `users/{uid}`                               | `preferences.boards.<boardId>.view`, `preferences.boards.<boardId>.priority[]`       |
| `users/{uid}/assistantSuggestions/{id}`     | `fields.priority.value`, `fields.horizon.value`, `applied.before.priority`           |
| `users/{uid}/assistantTidies/{id}`          | `moves[].from`, `moves[].to`                                                         |
| `users/{uid}/boardOperations/{operationId}` | `result.data.priority`, `.horizon`, `.colour` (stored receipts)                      |
| `users/{uid}/assistantConversations/{id}`   | `messages[]` (the model library's opaque history, embedding note DTOs)               |

No `where()` filters on these fields; `firestore.indexes.json` covers only `members(userId|invitedEmail, status)` and `notes(whiteboardId, assigneeId)`; `firestore.rules` denies all clients. None of them changes. Browser storage holds none of these values. Non-persisted carriers: board URLs (`?view=wand&priority=HOCH`), `GET /whiteboards/:id/notes?priority=&horizon=`, MCP `list_notes` cursors; after this PR an old spelling there is simply not a valid value.

Code that names an old value (`\b(HOCH|…|OLIV)\b` case-sensitive, `'wand'`/`"wand"`, `view=wand`, `--note-<old>`): 23 files in `apps/api/src`, 9 in `apps/api/test`, 60 in `apps/web/src` (33 of them tests, plus the three stylesheets), 5 in `packages/shared/src`, 2 E2E specs. Lowercase colour slugs also sit in the landing page (`'butter'`, `'minze'`, `'himmel'`, `'weiss'` in `LandingDemo.tsx`, `LandingVoice.tsx`, `demo.ts`, `DemoInput.tsx`, `LandingViews.tsx`, `routes/WelcomePage.tsx`, `styles/landing.css`). `SAND`, `EIS` and `BUTTER` appear only as values; `ROSE` keeps its spelling; the brand rule's "No sparkle, wand, robot or brain icon" is English prose and stays.

### Rulings

- **R1. Old spellings are invalid, not translated.** The shared schemas stay plain `z.enum(values)`; no legacy map, no preprocess, no read fix, no migration mode. A request with `HOCH` gets the same 400 as one with `FOO`; a stale link `?view=wand&priority=HOCH` opens the saved or default view without that filter. Cost if wrong: if any German-valued document survives the reset, its board answers 500 until the document is deleted.
- **R2. The model's and MCP's schemas list only English**, and tests pin it, so the model is never offered an old value; the capture and tidy prompts name only English values. A byte change in the capture prompt invalidates the provider's prompt cache once (ADR-0014 already accepts this).
- **R3. CSS variables and landing slugs follow the colour keys** in lowercase kebab case: `--note-chalk`, `--note-sea-green`, `data-colour='oat'`. Cost if wrong: a rename.
- **R4. The E2E account keeps its German profile** (R2 of the model plan): edited specs still assert the German UI.
- **R5. Old spellings stay only where a test shows they are refused.** The guard of Task 4 exempts the capture parser's German word list, the German catalogue values in `de.ts`, itself, and five refusal tests on the lines that hold their old spellings. Historical plans, specs and ADRs under `docs/` are outside its scan and are never rewritten.
- **R6. The runbook deletes production data after the deploy, not before.** Deleting before tagging leaves the old API running on an empty database, where a sign-in or a new note would write German values again; deleting right after the deploy leaves a window of minutes in which an existing board answers 500. The release smoke tests read no board data (`/health`, a 401 on `/whiteboards`, static pages), so that window does not trigger the automatic rollback.

## Global Constraints

- Work only in `/Users/mr_user/development/apps/wally-english-values`, branch `feat/english-values` (fast-forwarded to `origin/main` 157bca44; base `main`; never stacked). Never run git or edit files in `/Users/mr_user/development/apps/wally` (bind-mounted into the owner's running stack) or in any other worktree. No docker command of any kind. Never run `pnpm maintenance`, `pnpm seed` or any script that writes to `localhost:8080` with project `wally-local` (the owner's board).
- API route tests need the Firestore emulator on `localhost:8080` and run ONE FILE AT A TIME: `cd /Users/mr_user/development/apps/wally-english-values/apps/api && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=wally-local CORS_ORIGIN=http://localhost:5173 pnpm vitest run test/<file>`. Each file uses its own `wally-test-…` project id. Never two emulator runs at once, never the whole API suite in one command. Unit tests under `apps/api/src` need no emulator: `pnpm vitest run src/<file>`.
- Web tests touch no emulator: `cd apps/web && pnpm vitest run <file>`; the whole web suite once at the end of each task that touches it.
- Checks from the worktree root (the `make` targets run inside docker, so use these): `pnpm --filter @wally/shared typecheck`, `pnpm --filter @wally/shared build`, `pnpm --filter @wally/api typecheck`, `pnpm --filter @wally/api lint`, `pnpm --filter @wally/web typecheck`, `pnpm --filter @wally/web lint`, `pnpm format:check` (fix with `pnpm format`).
- Value table (ADR-0014, verbatim): priority `HOCH, MITTEL, NIEDRIG` → `HIGH, MEDIUM, LOW`; horizon `HEUTE, DIESE_WOCHE, SPAETER` → `TODAY, THIS_WEEK, LATER`; colour `WEISS, EIS, SAND, MINZE, HIMMEL, NEBEL, BUTTER, LEHM, ROSE, MALVE, FLIEDER, SEEGRUEN, SALBEI, OLIV` → `CHALK, ICE, STONE, MINT, SKY, MIST, OAT, CLAY, ROSE, MALLOW, HEATHER, SEA_GREEN, SAGE, OLIVE` (same order); board view `wand` → `wall`.
- Unchanged: catalogue VALUES in `de.ts`, the capture parser's German word list, `INITIAL_BOARD_NAME.de = 'Meine Wand'`, `DEFAULT_LANGUAGE = 'de'`, ADR-0007, every historical plan and spec under `docs/superpowers/`, ADR-0014's body (only its status line changes).
- The sweep. Every literal rename in Tasks 2 and 3 uses this command on an explicit file list, and the implementer reads the whole diff afterwards:

```bash
perl -pi -e 's/\bHOCH\b/HIGH/g; s/\bMITTEL\b/MEDIUM/g; s/\bNIEDRIG\b/LOW/g; s/\bHEUTE\b/TODAY/g; s/\bDIESE_WOCHE\b/THIS_WEEK/g; s/\bSPAETER\b/LATER/g; s/\bWEISS\b/CHALK/g; s/\bEIS\b/ICE/g; s/\bSAND\b/STONE/g; s/\bMINZE\b/MINT/g; s/\bHIMMEL\b/SKY/g; s/\bNEBEL\b/MIST/g; s/\bBUTTER\b/OAT/g; s/\bLEHM\b/CLAY/g; s/\bMALVE\b/MALLOW/g; s/\bFLIEDER\b/HEATHER/g; s/\bSEEGRUEN\b/SEA_GREEN/g; s/\bSALBEI\b/SAGE/g; s/\bOLIV\b/OLIVE/g; s/'"'"'wand'"'"'/'"'"'wall'"'"'/g; s/"wand"/"wall"/g; s/view=wand\b/view=wall/g' <files>
```

The file list of a directory is what this prints, minus each task's exclusions:

```bash
grep -rlE "\b(HOCH|MITTEL|NIEDRIG|HEUTE|DIESE_WOCHE|SPAETER|WEISS|EIS|SAND|MINZE|HIMMEL|NEBEL|BUTTER|LEHM|MALVE|FLIEDER|SEEGRUEN|SALBEI|OLIV)\b|['\"]wand['\"]|view=wand|--note-(weiss|eis|sand|minze|himmel|nebel|butter|lehm|malve|flieder|seegruen|salbei|oliv)\b" <dir>
```

- No new dependency. Conventional Commits; never commit to `main`; commit with `git -c core.hooksPath=/dev/null commit`; commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the model that wrote them). Prettier: single quotes, trailing commas, width 100.

## Review Focus

1. **Every writer emits English, including the ones that fill in a default or copy a value:** note create defaults, move history `metadata.from`/`to`, suggestion keep and undo (`EMPTY.priority`, the `horizon` defaults in `suggestions.ts`), Tidy's date rule and its Sunday case, duplicate, the capture parser's output, the seed. Tests in Tasks 2 and 3.
2. **An old spelling is refused everywhere it can enter:** `POST /whiteboards/:id/notes` with `priority: 'HOCH'`, `POST /notes/:id/move` with `horizon: 'SPAETER'`, `PATCH /me` with `view: 'wand'`, `?priority=HOCH` on the notes list, MCP `move_note`. Each answers 400 and writes nothing. Tests in Task 2.
3. **The model sees only English:** the capture and tidy prompts, the assistant tool schemas, the MCP tool schemas; a model reply carrying `HOCH` is refused, not stored. Tests in Task 2.
4. **Every colour still renders in every palette and both themes:** each `--note-*` variable renamed in every block of `globals.css` and `palettes.css`, the landing slugs and their selectors. Tests in Task 3.
5. **A stale link** (`?view=wand&axis=priority&priority=HOCH`) opens the board in the saved or default view without that filter, and does not throw. Test in Task 3.

---

### Task 1: Shared English values

**Files:**

- Modify: `packages/shared/src/enums.ts` (value arrays; comments on the language block, the colour set and `boardViewValues`), `packages/shared/src/schemas/note.ts` (defaults `MEDIUM`, `TODAY`, `CHALK`), `packages/shared/src/schemas/assistant.ts` (suggestion subsets), `packages/shared/src/utils/horizon.ts`, `packages/shared/src/utils/query.ts` (comment example `?priority=HIGH,MEDIUM`), `apps/web/src/englishIdentifiers.test.ts`
- Test: `apps/api/src/lib/sharedValues.test.ts` (create; `packages/shared` has no test runner, and adding one is a new dependency)

**Interfaces:**

- Produces: `notePriorityValues = ['HIGH', 'MEDIUM', 'LOW']`, `noteHorizonValues = ['TODAY', 'THIS_WEEK', 'LATER']`, `noteColourValues = ['CHALK', 'ICE', 'STONE', 'MINT', 'SKY', 'MIST', 'OAT', 'CLAY', 'ROSE', 'MALLOW', 'HEATHER', 'SEA_GREEN', 'SAGE', 'OLIVE']`, `boardViewValues = ['wall', 'list']`; schemas stay `z.enum(values)`; `suggestionFieldsSchema` `priority.value: z.enum(['HIGH', 'LOW'])`, `horizon.value: z.enum(['THIS_WEEK', 'LATER'])`; `horizonForDueDate` returns `TODAY | THIS_WEEK | LATER`.

- [ ] **Step 1: Write the failing test** `apps/api/src/lib/sharedValues.test.ts` (imports `@wally/shared`, `zod`, `ai`):
  - `it('stores the English values of ADR-0014')`: the four arrays equal the Produces lists exactly, in order.
  - `it('defaults a new note to MEDIUM, TODAY and CHALK')`: `noteCreateSchema.parse({})`.
  - `it('refuses the old spellings like any unknown value')`: for each old spelling of the value table (built in the test from one `const OLD = { priority: [...], horizon: [...], colour: [...], view: ['wand'] }`), the matching schema's `safeParse` fails; `noteListQuerySchema.safeParse({ priority: 'HOCH' })` fails; `boardPreferencesSchema.safeParse({ view: 'wand', axis: 'horizon', done: true, mine: false, priority: [] })` fails.
  - `it('proposes only This week or Later, and High or Low')`: `suggestionFieldsSchema.shape.horizon` accepts `{ value: 'THIS_WEEK', reason: '' }`, refuses `TODAY`; `priority` accepts `LOW`, refuses `MEDIUM`.
  - `it('places a dated note on the horizon in English')`: `horizonForDueDate` gives `TODAY`, `THIS_WEEK`, `LATER` for today, this Sunday, next Monday.
  - `it('publishes the English values in JSON schema')`: `JSON.stringify(await zodSchema(z.object({ p: notePrioritySchema, h: noteHorizonSchema, c: noteColourSchema, v: boardViewSchema })).jsonSchema)` contains `"enum":["HIGH","MEDIUM","LOW"]` and `"SEA_GREEN"`.

  This file is on the Task 4 guard's allow-list (it must spell the old values to show they are refused).

- [ ] **Step 2: Run it:** `cd apps/api && pnpm vitest run src/lib/sharedValues.test.ts` → FAIL.
- [ ] **Step 3: Implement** the Produces list. Rewrite the `enums.ts` comments: the values are English (ADR-0014, ADR-0024); the colour keys are the English labels in the original order; each colour needs labels in both catalogues, an `enumLabels.ts` entry, a `--note-<kebab>` fill and a `noteColourFillClass` entry; the "nothing had to be renamed or migrated in Firestore" sentence goes.
- [ ] **Step 4: Update the identifier guard** `apps/web/src/englishIdentifiers.test.ts`: delete the `text === 'wand'` and `?view=wand` entries of `ALLOWED_WAND_LITERALS` (keep the brand-prose entry) and their comment; replace the last test with `it('stores the board view as wall (ADR-0014, ADR-0024)')` asserting `boardViewValues` equals `['wall', 'list']`.
- [ ] **Step 5: Run** the test file (PASS), `pnpm --filter @wally/shared typecheck`, `pnpm --filter @wally/shared build`. The API and web typechecks and suites fail until Tasks 2 and 3.
- [ ] **Step 6: Commit:** `feat(shared)!: English persisted values (ADR-0014, ADR-0024)`.

### Task 2: The API in English

**Files:**

- Modify (source): every file the list grep prints for `apps/api/src` (23: `assistant/{captureProposal,suggestions,tidyPlan,tidyPrompt,capturePrompt}.ts`, `assistant/model/{tidy,types,suggest}.ts`, `assistant/eval/captureFixtures.ts`, `db/types.ts`, `mcp/widget.ts`, `seed.ts`, and their tests).
- Modify (tests): every file the list grep prints for `apps/api/test` (9: `assistant-operations`, `assistant-provenance`, `assistant-suggestions`, `assistant-tidies`, `mcp`, `me`, `membership-integrity`, `notes`, `private-notes`); `apps/api/src/lib/assistant/operations.test.ts` (new case).

**Interfaces:**

- Consumes: Task 1's values.
- Produces: `AssistantSuggestionDoc.fields.priority.value: 'HIGH' | 'LOW'`, `fields.horizon.value: 'THIS_WEEK' | 'LATER'`, the same in `model/types.ts`; model reply schemas `z.enum(['HIGH', 'LOW'])`, `z.enum(['THIS_WEEK', 'LATER'])`.

- [ ] **Step 1: Write the failing tests.**
  - `apps/api/src/lib/mcp/tools.test.ts` → `it('publishes only the English values in its tool schemas')`: `JSON.stringify(toJsonSchemaCompat(tool.inputSchema))` (from `@modelcontextprotocol/sdk/server/zod-json-schema-compat.js`) for `move_note` contains `THIS_WEEK` and `HIGH`, for `create_note` `SEA_GREEN`, for `list_notes` `LATER`.
  - `apps/api/src/lib/assistant/operations.test.ts` → `it('offers the model English filter values')`: `(await zodSchema(modelOperationInputs.list_notes).jsonSchema)` has `properties.priority.items.enum` `['HIGH','MEDIUM','LOW']` and `properties.horizon.items.enum` `['TODAY','THIS_WEEK','LATER']`.
  - `capturePrompt.test.ts` → the prompt contains `THIS_WEEK`, `LATER`, `TODAY`, `HIGH`, `LOW`; `tidyPrompt.test.ts` → `THIS_WEEK`, `LATER`.
  - `model/suggest.test.ts` and `model/tidy.test.ts` → a reply with `HIGH` / `THIS_WEEK` is accepted, one with `HOCH` / `DIESE_WOCHE` refused.
  - `apps/api/test/notes.test.ts` → `it('refuses a value that is not one of the English ones')`: POST a note with `priority: 'HOCH'` → 400, no note stored; POST `/notes/:id/move` `{ mode: 'HORIZON', horizon: 'SPAETER' }` → 400, note unchanged; `GET /whiteboards/:id/notes?priority=HOCH` → 400.
  - `apps/api/test/me.test.ts` → PATCH `/me` with a board's `view: 'wand'` → 400, preferences unchanged.
  - `apps/api/test/mcp.test.ts` → `move_note` with `horizon: 'SPAETER'` is refused as invalid input.

  Write the old spellings in these refusal cases from a local `const` at the top of each file, so the Task 4 guard's allow-list can name the files (see Task 4).

- [ ] **Step 2: Run them** → FAIL (the schema tests fail on `HOCH` in the enums; the refusal tests fail with 201/200).
- [ ] **Step 3: Sweep** the listed files with the Global Constraints command, excluding the refusal cases of Step 1 (add them after the sweep, or restore them by hand). Then fix by hand what a word swap gets wrong: the prompt sentences read naturally (`capturePrompt.ts`: "horizon: THIS_WEEK for this week; LATER for next week, later, soon or someday. With a due date it follows the date: until this Sunday THIS_WEEK, after it LATER, today none. Never TODAY, which is the default. Otherwise null." and "priority: HIGH when … LOW when it can wait …", keeping the German trigger words; `tidyPrompt.ts`: "THIS_WEEK for This week or LATER for Later", "every later date is Later (LATER)"); the widget keeps each hex with its new key (`CHALK:'#d9d9d9', STONE:'#d4cbbd', OAT:'#e5c966', CLAY:'#dba98c', MIST:'#aab9ca', SAGE:'#aec39e', HEATHER:'#c2b1df', ICE:'#a8cbd4', SKY:'#a3cce4', MINT:'#a7cfb7', SEA_GREEN:'#97c5ba', OLIVE:'#c1c795', ROSE:'#ddaebb', MALLOW:'#c8a8cf'`, fallback `colours.CHALK`); test names that spell a value change with it.
- [ ] **Step 4: Run** `pnpm --filter @wally/api typecheck`, `pnpm --filter @wally/api lint`, `cd apps/api && pnpm vitest run src`, then each of the nine route files alone with the emulator. All PASS.
- [ ] **Step 5: Commit:** `feat(api)!: write, prompt and offer the English values`.

### Task 3: The web in English

**Files:**

- Modify: every file the list grep prints for `apps/web/src` except `englishIdentifiers.test.ts` (60: among them `i18n/{de,en,enumLabels}.ts`, `features/board/util/noteDerived.ts`, `styles/{globals,palettes,landing}.css`, `BoardSwitcher.tsx`, `BoardViewToggle.tsx`, `AppShell.tsx`, `BoardCommands.tsx`, `PriorityIcon.tsx`, `WallView/ZoneBands.tsx`, `hooks/useBoardViewState.ts`, `hooks/mutations/useCreateNote.ts`, `lib/capture/parseCapture.ts` (output values only), `test/fixtures.ts`, `mcp/CardWidget.test.ts`, and 33 test files, `TopBar.test.tsx` and `BoardCommands.test.tsx` for `view="wand"`); the landing files `features/landing/{LandingDemo,LandingVoice,DemoInput,LandingViews}.tsx`, `features/landing/demo.ts`, `routes/WelcomePage.tsx`; `docs/BRAND.md`.
- Test: `apps/web/src/features/board/util/noteDerived.test.ts`, `apps/web/src/features/board/hooks/useBoardViewState.test.tsx`

**Interfaces:**

- Consumes: Task 1's values.
- Produces: catalogue keys `enums.priority.{HIGH,MEDIUM,LOW}`, `enums.horizon.{TODAY,THIS_WEEK,LATER}`, `enums.colour.{CHALK…OLIVE}`, `board.zone.priorityHints.{HIGH,MEDIUM,LOW}` in both catalogues (values unchanged); CSS variables `--note-chalk, --note-ice, --note-stone, --note-mint, --note-sky, --note-mist, --note-oat, --note-clay, --note-rose, --note-mallow, --note-heather, --note-sea-green, --note-sage, --note-olive` in every block that defines `--note-*` today; landing slugs `chalk, oat, mint, sky, rose`; `DEFAULT_BOARD_PREFERENCES.view = 'wall'`.

- [ ] **Step 1: Write the failing tests.**
  - `noteDerived.test.ts` → `it('fills every colour from its own variable, in every palette')`: for each of `noteColourValues`, `noteColourFillClass[c]` equals `` `bg-[color:var(--note-${c.toLowerCase().replace('_', '-')})]` ``, and `globals.css` and `palettes.css` (read with `readFileSync`) define that variable as often as they define `--note-chalk`.
  - `useBoardViewState.test.tsx` → `it('ignores a stale link with values that no longer exist')`: route `?view=wand&axis=priority&priority=HOCH` → `view` is the saved view (or `'wall'` with none saved), `axis: 'priority'`, `priority: []`; `?view=wall&priority=HIGH,LOW` → `'wall'`, `['HIGH','LOW']`. (This file holds old spellings on purpose; see Task 4.)
- [ ] **Step 2: Run them** → FAIL.
- [ ] **Step 3: Sweep** the listed files with the Global Constraints command, excluding `useBoardViewState.test.tsx` (edit its other cases by hand). Then by hand: the `--note-*` renames (`s/--note-weiss\b/--note-chalk/g; s/--note-eis\b/--note-ice/g; s/--note-sand\b/--note-stone/g; s/--note-minze\b/--note-mint/g; s/--note-himmel\b/--note-sky/g; s/--note-nebel\b/--note-mist/g; s/--note-butter\b/--note-oat/g; s/--note-lehm\b/--note-clay/g; s/--note-malve\b/--note-mallow/g; s/--note-flieder\b/--note-heather/g; s/--note-seegruen\b/--note-sea-green/g; s/--note-salbei\b/--note-sage/g; s/--note-oliv\b/--note-olive/g` over the stylesheets, `noteDerived.ts`, `BoardSwitcher.tsx`); the landing slugs `'butter'→'oat'`, `'minze'→'mint'`, `'himmel'→'sky'`, `'weiss'→'chalk'` and their `[data-colour='…']` selectors and `data-colour="himmel"` attributes. Read the whole diff: in `de.ts` and `en.ts` only keys change; a test asserting a German label still asserts it (R4).
- [ ] **Step 4: `docs/BRAND.md`.** Under "Note colour belongs to the user": replace "the German keys they replace are migrated in place (ADR-0014)" with `they replaced the German keys in one release with a data reset ([ADR-0024](adr/ADR-0024-rename-persisted-values-without-migration.md))`, and add a table, one row per colour in `noteColourValues` order: key, CSS variable, English label (from `en.ts`). Under "'Wand' is the German word for the wall": the stored board view is `wall` too.
- [ ] **Step 5: Run** the two test files (PASS), the whole web suite `cd apps/web && pnpm vitest run` (guards, `i18n/resources`, `noHardcodedCopy`, `germanSurface`, `palettes` included), `pnpm --filter @wally/web typecheck`, `pnpm --filter @wally/web lint`.
- [ ] **Step 6: Commit:** `feat(web)!: English values, catalogue keys and note colour variables`.

### Task 4: A guard for the old spellings, and the E2E specs

**Files:**

- Create: `apps/web/src/englishValues.test.ts`
- Modify: `apps/web/e2e/note-card-actions.spec.ts` (`?view=wand` → `?view=wall`, three URLs), `apps/web/e2e/capture-review.spec.ts` (the stubbed proposal's `horizon.value: 'THIS_WEEK'`)

- [ ] **Step 1: Write the guard** in the style of `brandGuards.test.ts`: a text scan over `apps/web/src`, `apps/web/e2e`, `apps/web/index.html`, `apps/api/src`, `apps/api/test`, `packages/shared/src` (`.ts`, `.tsx`, `.css`, `.html`) that fails on `\b(HOCH|MITTEL|NIEDRIG|HEUTE|DIESE_WOCHE|SPAETER|WEISS|EIS|SAND|MINZE|HIMMEL|NEBEL|BUTTER|LEHM|MALVE|FLIEDER|SEEGRUEN|SALBEI|OLIV)\b` (case-sensitive), `['"]wand['"]`, `view=wand`, `--note-(weiss|eis|sand|minze|himmel|nebel|butter|lehm|malve|flieder|seegruen|salbei|oliv)\b` and `['"](weiss|eis|sand|minze|himmel|nebel|butter|lehm|malve|flieder|seegruen|salbei|oliv)['"]`. Allow-list, repo-relative, each with its reason: `apps/web/src/i18n/de.ts` (German catalogue values), `apps/web/src/lib/capture/parseCapture.ts` (the German word list), this file (it names the patterns), and the refusal tests that must spell an old value to show it is refused: `apps/api/src/lib/sharedValues.test.ts`, `apps/api/test/notes.test.ts`, `apps/api/test/me.test.ts`, `apps/api/test/mcp.test.ts`, `apps/web/src/features/board/hooks/useBoardViewState.test.tsx`. For those five, the guard checks that the old spellings appear only on the lines of their one `OLD` constant (or, in the hook test, the stale-link case), so the sweep cannot have missed anything else in them. Docs are outside the scan; historical plans and ADRs keep their values.
- [ ] **Step 2: Run it:** `cd apps/web && pnpm vitest run src/englishValues.test.ts` → PASS after Tasks 1–3. A hit is fixed in the file, not in the allow-list.
- [ ] **Step 3: Edit** the two specs; `cd apps/web && pnpm exec playwright test --list` lists every spec without error; `pnpm format:check`.
- [ ] **Step 4: Commit:** `test: guard against the old value spellings; E2E specs use the English values`.

### Task 5: ADR-0024, the ADR index and the release runbook

**Files:**

- Create: `docs/adr/ADR-0024-rename-persisted-values-without-migration.md`
- Modify: `docs/adr/ADR-0014-english-identifiers-and-persisted-values.md` (status line only), `docs/adr/README.md` (rows for ADR-0014 and ADR-0024), `docs/DEPLOY.md` (new section)

- [ ] **Step 1: ADR-0024**, from `docs/adr/ADR-0000-template.md`, 300–500 words. Header: Status `accepted`; Date 2026-10-27; Deciders Milad Rezazadeh; Supersedes `the migration steps (expand, migrate, contract) of [ADR-0014](ADR-0014-english-identifiers-and-persisted-values.md); its values and names stand`. Context: ADR-0014 planned an expand release with a legacy map and read normalisation, an in-place migration with a backup, and a contract release weeks later; on 2026-10-27 the owner judged that no stored data was worth keeping (production and the local emulator). Considered options: (1) ADR-0014's expand, migrate, contract: keeps data, costs two releases, a legacy map, a migration mode and a 30-day wait; (2) rename in one release and delete all Firestore data: one change, no legacy code, loses every board. Decision: option 2; the old spellings are invalid after the release, like any other unknown value. Consequences: Good: one release, no legacy map, migration code or contract step, and the code and the data hold one spelling from the first write. Bad: everyone starts from an empty board; accounts are re-provisioned on the next sign-in with new Wally user ids (Auth0 identities are untouched); connected MCP apps must reconnect; the month's assistant usage and spend counters restart from zero; no rollback to a German-valued release once English data is written. Neutral: the runbook in `DEPLOY.md`. Confirmation: `apps/web/src/englishValues.test.ts` finds no old spelling in the code. More information: ADR-0014, `docs/DEPLOY.md` "Release with a data reset", this plan.
- [ ] **Step 2: ADR-0014's status line** becomes `accepted; its migration steps (expand, migrate, contract) are superseded by [ADR-0024](ADR-0024-rename-persisted-values-without-migration.md)`. Nothing else in ADR-0014 changes.
- [ ] **Step 3: `docs/adr/README.md` index.** ADR-0014 row: Decision `accepted; migration steps superseded by ADR-0024`; In production unchanged in substance (**partly live**: identifiers English since v0.5.0; stored values are still German until the release that carries ADR-0024). New ADR-0024 row after ADR-0023: title "Rename the persisted values in one release and reset the data", Decision `accepted`, In production `merged, not released`. Keep the table aligned (`pnpm format`). Leave the "Last checked" line as it is.
- [ ] **Step 4: `docs/DEPLOY.md`**, a section "Release with a data reset (ADR-0024)" after "Deploying again later", with the runbook at the end of this plan.
- [ ] **Step 5: Run** `pnpm format:check`.
- [ ] **Step 6: Commit:** `docs: ADR-0024 renames the persisted values with a data reset; release runbook`.

### Task 6: Verification

- [ ] **Step 1:** From the worktree root: `pnpm --filter @wally/shared build`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`. PASS.
- [ ] **Step 2:** `cd apps/web && pnpm vitest run`. PASS.
- [ ] **Step 3:** `cd apps/api && pnpm vitest run src`, then every file under `apps/api/test/` ONE AT A TIME with the emulator command of the Global Constraints, in `ls` order, each finished before the next. PASS.
- [ ] **Step 4: Confirmation greps.**

```bash
grep -rnwE 'HOCH|MITTEL|NIEDRIG|HEUTE|DIESE_WOCHE|SPAETER|WEISS|EIS|SAND|MINZE|HIMMEL|NEBEL|BUTTER|LEHM|MALVE|FLIEDER|SEEGRUEN|SALBEI|OLIV|wand' apps/*/src apps/api/test packages/shared/src apps/web/e2e
grep -rnE -- '--note-(weiss|eis|sand|minze|himmel|nebel|butter|lehm|malve|flieder|seegruen|salbei|oliv)\b' apps/web
```

Expected: the second prints nothing; the first prints only the Task 4 allow-list's files on their permitted lines, `englishIdentifiers.test.ts` (its banned-word list) and the brand rule's prose in `brandGuards.test.ts`.

- [ ] **Step 5:** `cd apps/web && pnpm exec playwright test --list`. The E2E run is CI's, on the pull request.
- [ ] **Step 6: PR description:** the decision (ADR-0024), the rulings, that the release needs the owner's data reset (link the runbook), and that the PR is breaking for any client holding old values.

## Runbook: release with a data reset (for `docs/DEPLOY.md`; the owner runs every command)

**Production**

1. Merge, push the `v*` tag, approve the `production` environment, and wait for the release workflow to finish (its smoke tests read no board data, so existing German-valued boards do not trip them; R6).
2. Right away, delete every document in the production database:

   ```bash
   npx --yes firebase-tools@15.30.2 firestore:delete --all-collections --database wally --project luminull-wally
   ```

   Verified on 2026-10-27 against `firebase firestore:delete --help` of firebase-tools 15.30.2, the version `FIREBASE_TOOLS_VERSION` pins in `.github/workflows/release.yml`: `--all-collections` "deletes all collections and documents in the Firestore database", `--database <databaseId>` selects the database (`(default)` otherwise, which is the wrong, US one; `firebase.json` and Cloud Run use `wally`), `-P, --project` is a global option. Without `--force` the command asks for confirmation; keep it that way. Not verified: which of the owner's accounts holds the permission to run it, and that it also removes documents under parent documents that do not exist (check in the Firebase console afterwards that no collection remains). Composite indexes, TTL policies and rules are configuration, not documents, and stay.

3. Sign in at `wally.luminull.com`: a new user and a first board are provisioned. Reconnect any MCP app.
4. Rolling back to a release before this one is not possible once English data exists (ADR-0024); fix forward.

**Local emulator** (in-memory; it holds the owner's current board)

1. Pull `main` into the live checkout.
2. `docker compose restart firestore api web`. The emulator starts empty: `docker-compose.yml` runs `firebase emulators:start --only firestore` without `--import` or `--export-on-exit`, and mounts only `firebase.json`, the rules and the indexes, read-only (checked on 2026-10-27). The `api` and `web` restarts pick up the pulled code (their watchers miss git changes).
3. Optional: `make seed` for the demo board.

## Follow-ups (not in this PR)

- When the release with this PR is deployed and the reset done: ADR-0014's and ADR-0024's In production cells become **live** since that version.
- The E2E account's profile language (R4) stays German until its own PR.

## Self-review

- Coverage of the coordinator's brief: English arrays (Task 1); literals across api, web, seed, eval fixtures, tests (Tasks 2, 3); capture and tidy prompts, model and MCP schemas English with tests, widget maps (Task 2); catalogue keys, CSS variables, landing slugs, BRAND.md table (Task 3); E2E specs and the guard with its allow-list (Task 4); ADR-0024, ADR-0014 status, both index rows, the DEPLOY.md runbook with the verified command and the emulator check (Task 5); verification (Task 6). Removed: legacy map, read fixes, migration mode, legacy-link spec, cursor ruling, rollback and open-tab discussion, step-6 follow-up.
- Type consistency: the value arrays of Task 1 are the only new names; Tasks 2–4 consume them.
- Review Focus: 1 → Tasks 2, 3; 2 → Task 2; 3 → Task 2; 4 → Task 3; 5 → Task 3.
