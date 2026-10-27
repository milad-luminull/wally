# Smarter Capture Implementation Plan

> **Status:** executed in PR #63.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wallybot's fill-in on a fresh note infers what a person means (horizon, privacy, tags, several properties, description, real priorities, natural steps) and shows the proposal as a labelled list with a visible 15 s countdown and Undo / Keep, on the wall and in the list.

**Architecture:** The capture call is split into a pure seam (`captureProposal.ts`: candidates, prompt context, acceptance and consistency rules) that both the route and an owner-run scoring script use. New fields join the shared suggestion contract and the existing keep/undo chain as steps over operations that already exist. The web replaces the in-place pending chips with a `ProposalList` and a `ReviewFooter` used by both the wall card and the list row.

**Tech Stack:** TypeScript, Fastify API on Firestore, `ai` SDK with Vertex Gemini 2.5 Flash (structured output), zod contracts in `@wally/shared`, React + TanStack Query + Tailwind, i18next, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-smarter-capture-design.md` (read it first; this plan argues from it).

## Global Constraints

- Worktree `/Users/mr_user/development/apps/wally-capture`, branch `feat/smarter-capture`. Never touch `/Users/mr_user/development/apps/wally` (live, bind-mounted) except to read.
- **No push and no PR until the owner has reviewed the branch and said OK** (spec decision 7). Then one PR against `main`, never stacked.
- Model unchanged: `vertex:gemini-2.5-flash`, thinking off. Do not touch `config.ts`.
- `COUNTDOWN_MS = 15_000`. `UNDO_WINDOW_MS` stays `30_000`.
- Opt-in fields, never kept by the countdown: `title`, `description`, `visibility` (one shared constant, Task 2).
- Wallybot proposes `visibility` only as `PRIVATE`, `horizon` only as `DIESE_WOCHE` or `SPAETER`, and only on the note just written.
- `SUGGESTION_MAX_OUTPUT_TOKENS = 1024`. `SUGGESTION_MIN_CONFIDENCE` stays `0.6`.
- At most 3 tags (`SUGGESTION_MAX_TAGS`) and 3 properties (`SUGGESTION_MAX_PROPERTIES`) per proposal; at most 10 recent own notes (`CAPTURE_MAX_RECENT_NOTES`) and 3 example values per property key (`CAPTURE_MAX_KEY_VALUES`) in the prompt.
- Persisted enum values stay German (ADR-0014): `HEUTE`, `DIESE_WOCHE`, `SPAETER`, `HOCH`, `NIEDRIG`, `PRIVATE`. New suggestion field keys are appended to `suggestionFieldKeys` (order is the chain's canonical order; never reorder existing keys).
- Code, identifiers, test data and fixtures in English. New UI strings in `apps/web/src/i18n/de.ts` (authority) and `en.ts`.
- BRAND.md "## AI": no name or pronoun in copy, no sparkle/wand/robot/brain icon, no toast, no badge counting suggestions; motion 120–180 ms on opacity and transform only, off under reduced motion; use semantic tokens (`--accent`, `--note-border`, `--fg-meta-on-note`, `--primary`), never hard-coded amber.
- Emulator holds the owner's real data: route tests one file at a time, never two emulator test files at once, never restart or `down` the `firestore` service.
- Commands (from the worktree root unless stated):
  - shared build: `pnpm --filter @wally/shared build`
  - API unit test: `cd apps/api && pnpm vitest run <path>`
  - API route test: `cd apps/api && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=wally-local CORS_ORIGIN=http://localhost:5173 pnpm vitest run test/<one file>`
  - web test: `cd apps/web && pnpm vitest run <path>`
  - checks: `pnpm --filter @wally/api typecheck`, `pnpm --filter @wally/api lint`, `pnpm --filter @wally/web typecheck`, `pnpm --filter @wally/web lint`, `pnpm format:check`
- Commit per task, Conventional Commits, each message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A pending record stored before deploy** (it holds `reference`, no new fields) must still read, show its one property row, keep and undo. Test in Task 6.
2. **A tag or property value that exists only on the caller's private note** must never reach the prompt for a shared note. Test in Task 4.
3. **Undo of a kept Private** must leave the note shared and unassigned, as written, although making it private assigned the author. Test in Task 6.
4. **The countdown firing while only opt-in fields are ticked** (title, description, Private) keeps nothing, writes nothing and leaves the record pending; crossing out every row stops the countdown instead of discarding. Tests in Task 6 (server) and Task 8 (web).
5. **A note written into a column the person picked on the horizon wall** never gets a horizon proposed; one opened by the New note button can. Tests in Task 7, and Task 6 for the keep that moves the card and the undo that moves it back.

---

### Task 1: Capture seam and the scoring harness (baseline on today's prompt)

**Files:**

- Create: `apps/api/src/lib/assistant/captureProposal.ts`, `apps/api/src/lib/assistant/captureProposal.test.ts`
- Create: `apps/api/src/lib/assistant/eval/captureFixtures.ts`, `apps/api/src/lib/assistant/eval/score.ts`, `apps/api/src/lib/assistant/eval/score.test.ts`
- Create: `apps/api/src/capture-eval.ts`
- Modify: `apps/api/src/lib/assistant/suggestions.ts` (move `candidates`, `collectKeys`, `accept*` into the seam; `suggestForCapture` calls it), `apps/api/package.json` (script)

**Interfaces:**

- Produces (in `captureProposal.ts`):
  - `type CaptureNote = Pick<NoteDetailDto, 'id' | 'title' | 'description' | 'dueDate' | 'priority' | 'assignee' | 'visibility' | 'horizon' | 'tags' | 'customFields' | 'subtaskSummary' | 'links' | 'createdBy'>`
  - `type CaptureBoardNote = Pick<NoteDto, 'id' | 'title' | 'status' | 'createdAt' | 'visibility' | 'horizon' | 'priority' | 'tags' | 'customFields' | 'createdBy'>`
  - `interface CaptureContext { actorId: string; today: string; timeZone: string; language: Language; locked: SuggestionFieldKey[]; members: { id: string; name: string }[]; canChangeVisibility: boolean }` (`suggestForCapture` sets `canChangeVisibility` to `ctx.role !== 'VIEW'`, the command layer's rule for a visibility change in `commands/index.ts`; fixtures default it to `true`)
  - `function captureCandidates(note: CaptureNote, locked: SuggestionFieldKey[]): SuggestionFieldKey[]` (today's `candidates`, moved unchanged)
  - `function captureNeedsBoard(open: SuggestionFieldKey[]): boolean`
  - `interface CaptureCall { open: SuggestionFieldKey[]; instructions: string; prompt: string; others: Map<string, string>; fieldKeys: string[] }`
  - `function buildCaptureCall(note: CaptureNote, boardNotes: CaptureBoardNote[], ctx: CaptureContext): CaptureCall | null` — null when nothing may be proposed (no call is made)
  - `function acceptCapture(fields: ModelSuggestion, call: CaptureCall, note: CaptureNote, ctx: CaptureContext): AssistantSuggestionDoc['fields'] | null` — null when nothing survived
  - `collectKeys` re-exported from here (moved).
- Produces (eval): `interface CaptureFixture { id: string; antiGoal?: boolean; note: Partial<CaptureNote> & { title: string }; board?: { members?: ...; notes?: Partial<CaptureBoardNote>[] }; today: string; expect: FixtureExpect }`, `scoreFixture(fixture, accepted): FieldScore[]`, `summarize(scores): Summary`.

- [ ] **Step 1: Set up the worktree.** Run `pnpm install --frozen-lockfile --offline && pnpm --filter @wally/shared build`. Expected: both succeed.
- [ ] **Step 2: Write the seam's failing tests** in `captureProposal.test.ts`: `buildCaptureCall returns null when every field is filled or locked`; `buildCaptureCall drops links when no other open note exists`; `acceptCapture drops low confidence, unknown members, past dates and links to notes not shown` (move the matching assertions from `test/assistant-suggestions.test.ts` cases at lines 504 and 596 down to this unit level; keep the route tests too). Use a fake `ModelSuggestion` literal, no runner.
- [ ] **Step 3: Run** `cd apps/api && pnpm vitest run src/lib/assistant/captureProposal.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement the seam** by moving code out of `suggestions.ts` without changing behaviour: `suggestForCapture` keeps the note read, the creator check and the early `captureCandidates` exit, reads members and (when `captureNeedsBoard`) `listNotes(..., { status: 'ALL' })`, then `buildCaptureCall` → runner (ledger `onAttempt` unchanged) → `acceptCapture` → store. Prompt text and accept rules stay byte-identical in this task.
- [ ] **Step 5: Run** the seam test, then `test/assistant-suggestions.test.ts` (route, one file). Expected: PASS, no route test changed.
- [ ] **Step 6: Write fixtures** in `eval/captureFixtures.ts`: 40 English notes with synthetic boards. Cover at least: 4 relative dates ("by Friday", "end of month", "EOD", "before the 3rd"); 4 vague spans ("this week", "next week", "soon", "sometime"); 4 inferred priorities both ways; 3 assignee phrasings ("ask Anna to…", "Anna sends…", "@anna"); 3 clearly personal notes (doctor, salary talk, gift for a colleague) expecting `PRIVATE`; 4 notes with two or three properties reusing board keys and spellings; 3 notes matching existing board tags; 4 naturally multi-step tasks ("prepare board meeting"); 3 long rambling titles expecting a title and a description; and **anti-goal fixtures (`antiGoal: true`)**: "call mom" expecting nothing, a note naming a person not on the board (no assignee), a work note on a board where a tag exists only on the caller's private note (that tag must not be proposed on the shared note), a note the person wrote under the Shared filter (`locked: ['visibility']`, no visibility), a note with an assignee typed (no visibility). `FixtureExpect` per field: an exact value, `'any'` (presence, for title/description/subtasks), or `null` (must not be proposed). Tags/properties: list of acceptable values; right when every proposed item is acceptable and at least one is proposed.
- [ ] **Step 7: Write `score.test.ts`** for the scorer: `right / wrong / missed / extra` per field from hand-made accepted outputs; an anti-goal fixture with any `wrong` or `extra` counts as one anti-goal failure; a baseline output that has `reference` and no `properties` is scored as `properties` with that one item.
- [ ] **Step 8: Implement `score.ts`** (`scoreFixture`, `summarize`) to pass. Run `pnpm vitest run src/lib/assistant/eval/score.test.ts`. Expected: PASS.
- [ ] **Step 9: Implement `apps/api/src/capture-eval.ts`** and the script `"assistant:capture-eval": "tsx src/capture-eval.ts"`. It loads env like `assistant-smoke.ts`, builds `createConfiguredSuggestionRunner(env)`, and for each fixture runs `buildCaptureCall` → runner (an `onAttempt` that returns a no-op lease) → `acceptCapture` → `scoreFixture`; prints a per-field table, the totals, and every anti-goal failure with the fixture id; exits 1 when there is any anti-goal failure. No Firestore. The file header documents the exact command, using the env exporter the handoff names (`python3 -I /Users/mr_user/wally-emulator-data/exportenv.py`) the same way the preview setup does; verify the exporter's output form before writing the line.
- [ ] **Step 10: Run** `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint`. Expected: clean.
- [ ] **Step 11: Commit** `feat(api): split the capture call into a seam and add the capture scoring harness`.
- [ ] **Step 12: Owner checkpoint (baseline).** Stop and ask the owner to run the documented command on this commit and paste the summary. Record it under "Results" at the end of this plan and commit `docs: record the capture baseline`.

### Task 2: Shared contract for the new fields

**Files:**

- Modify: `packages/shared/src/schemas/assistant.ts`, `apps/api/src/lib/db/types.ts`

**Interfaces:**

- Produces:
  - `suggestionFieldKeys` = existing seven + `'horizon', 'visibility', 'tags', 'properties', 'description'` (appended in this order).
  - `export const suggestionOptInFieldKeys = ['title', 'description', 'visibility'] as const satisfies readonly SuggestionFieldKey[]`
  - `export const SUGGESTION_MAX_TAGS = 3`, `export const SUGGESTION_MAX_PROPERTIES = 3`
  - `suggestionFieldsSchema` adds: `horizon: { value: z.enum(['DIESE_WOCHE','SPAETER']), reason } | null`; `visibility: { value: z.literal('PRIVATE'), reason } | null`; `tags: { items: z.array(tagSchema-compatible string).min(1).max(3), reason } | null`; `properties: { items: z.array({ key, value }).min(1).max(3), reason } | null`; `description: { value: z.string().min(1).max(NOTE_DESCRIPTION_MAX_LENGTH), reason } | null`. `reference` stays (legacy, read-only for new records).
  - `suggestionDecisionSchema` adds `tags?: number[]` and `properties?: number[]` (same bounds pattern as `subtasks`, max 3, index max 2).
  - `suggestionDtoSchema.kept` adds `tags: number[]`, `properties: number[]`.
  - `AssistantSuggestionDoc.fields` adds the five optional fields (stored shapes: `tags: { items: string[]; reason }`, `properties: { items: { key; value }[]; reason }`); `decision` and `applied` add `tags?: number[]`, `properties?: number[]`; `SuggestionOperationIds` adds optional `horizon`, `description`, `tags`, `properties` (`{ apply; undo }`) and `visibility?: { apply: string; undo: string; undoAssignee: string }`.

- [ ] **Step 1:** Make the schema changes and run `pnpm --filter @wally/shared build`. Expected: builds.
- [ ] **Step 2:** Run `pnpm --filter @wally/api typecheck` and `pnpm --filter @wally/web typecheck`. Expected: errors only where a `Record<SuggestionFieldKey, …>` or exhaustive switch needs the new keys. Fix each with the narrowest change that keeps today's behaviour (new keys read as "not proposed"); real behaviour arrives in later tasks.
- [ ] **Step 3:** Run the existing API unit tests under `src/lib/assistant` and web tests under `src/features/board/Suggestions`. Expected: PASS.
- [ ] **Step 4: Commit** `feat(shared): add horizon, visibility, tags, properties and description to suggestions`.

### Task 3: The model's answer shape

**Files:**

- Modify: `apps/api/src/lib/assistant/model/suggest.ts`, `apps/api/src/lib/assistant/model/types.ts`
- Test: `apps/api/src/lib/assistant/model/suggest.test.ts`

**Interfaces:**

- Produces: `ModelSuggestion` drops `reference` and adds `horizon: { value: 'DIESE_WOCHE' | 'SPAETER'; confidence; reason } | null`, `visibility: { value: 'PRIVATE'; confidence; reason } | null`, `tags: { items: string[]; confidence; reason } | null`, `properties: { items: { key: string; value: string }[]; confidence; reason } | null`, `description: { value: string; confidence; reason } | null`.

- [ ] **Step 1: Write failing tests** in `suggest.test.ts`: `reads horizon, visibility, tags, properties and description from a reply`; `keeps the first three tags and properties, trimmed, blanks and repeats dropped`; `a tag or property too long for a note reads as not proposed, never costing the date beside it` (`.catch(null)`, like `subtasks`); `the wire schema sends no reference`.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/assistant/model/suggest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `modelSuggestionWireSchema` (only the keywords the file's Gemini note allows: enum, maxItems, nullable) and `modelSuggestionSchema` (lengths via `TAG_MAX_LENGTH`, `FIELD_KEY_MAX_LENGTH`, `FIELD_VALUE_MAX_LENGTH`, `NOTE_DESCRIPTION_MAX_LENGTH`; items deduped by fold like `steps`; every new field `.nullable().catch(null)`).
- [ ] **Step 4: Run** the test file. Expected: PASS. Fix any fake reply in other model tests that now lacks the new keys.
- [ ] **Step 5: Commit** `feat(api): let the capture model answer the new fields`.

### Task 4: The instructions and the board context

**Files:**

- Modify: `apps/api/src/lib/assistant/capturePrompt.ts`, `apps/api/src/lib/assistant/captureProposal.ts`
- Test: `apps/api/src/lib/assistant/capturePrompt.test.ts`, `captureProposal.test.ts`

**Interfaces:**

- Consumes: `CaptureBoardNote`, `CaptureContext` (Task 1).
- Produces: `buildCapturePrompt(input: { title; description; members; fieldKeys: { key: string; values: string[] }[]; tags: string[]; recent: RecentNoteRow[]; notes: { id; title }[] }): string` with `type RecentNoteRow = { title: string; horizon: NoteHorizon; priority: NotePriority; tags: string[]; properties: [string, string][] }`; constants `CAPTURE_MAX_RECENT_NOTES = 10`, `CAPTURE_MAX_KEY_VALUES = 3`; `function captureContextNotes(note: CaptureNote, boardNotes: CaptureBoardNote[]): CaptureBoardNote[]` (the private filter).

- [ ] **Step 1: Write failing tests:**
  - `capturePrompt.test.ts`: `the instructions are byte-stable and hold no board content` (keep); `the instructions name every field the schema has and forbid inventing names, numbers and dates`; `the prompt lists tags one per line, each key with up to three values, and up to ten recent own notes`.
  - `captureProposal.test.ts`: `a shared note's context leaves out every private note` (a tag `health` only on the caller's private note is absent from the prompt of a shared note, present for a private note); `recent rows are the caller's own notes, newest first, never the note itself`; `example values are the newest distinct ones per key, at most three`.
- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Rewrite `CAPTURE_INSTRUCTIONS_PREFIX`.** Opening rule (spec §1, wording yours): fill in what a capable assistant would set for this task from the words, the board and common sense; never invent a name, number, customer, date or person the words and board do not support; give null when unsure. One line per field from the spec's table (`dueDate`, `horizon`, `priority`, `assignee`, `visibility`, `title`, `description`, `properties`, `tags`, `subtasks`, `links`), including: vague spans go to `horizon`, never to a made-up date; `description` only together with a shorter `title`; reuse board keys, spellings and tags; `visibility` only `PRIVATE` and only for clearly personal matters or explicit words. Keep the confidence/reason line, the German trigger words, and the prompt-injection line. Reasons: no first person, no name.
- [ ] **Step 4: Implement** `captureContextNotes` (shared note → only `SHARED` board notes; private note → all) and the new prompt sections, fed from it in `buildCaptureCall`. `captureNeedsBoard` is now true whenever any of `properties`, `tags`, `links`, `horizon`, `priority`, `visibility` is open (the recent rows help those). Tags deduped with `foldFieldKey`.
- [ ] **Step 5: Run** both test files. Expected: PASS.
- [ ] **Step 6: Commit** `feat(api): ask the capture model to infer, with the board's tags, values and the person's recent notes`.

### Task 5: Candidates, acceptance and consistency rules

**Files:**

- Modify: `apps/api/src/lib/assistant/captureProposal.ts`, `apps/api/src/lib/assistant/suggestions.ts` (`SUGGESTION_MAX_OUTPUT_TOKENS = 1024`)
- Test: `captureProposal.test.ts`

**Interfaces:**

- Consumes: `ModelSuggestion` (Task 3), `horizonForDueDate` from `@wally/shared`.
- Produces: `captureCandidates` opens `horizon` (note at `HEUTE`, not locked), `visibility` (note `SHARED`, `createdBy.id === ctx.actorId`, `ctx.canChangeVisibility`, at least one other member in `ctx.members`, `assignee === null`, neither `assignee` nor `visibility` locked), `tags` (no tags), `properties` (no custom fields, replaces opening `reference`), `description` (empty description, not locked). `reference` is never opened again.

- [ ] **Step 1: Write failing tests** (one per rule): `opens each new field only while the note holds nothing there`; `never opens visibility for a viewer, on a board with no other member, on a note with an assignee, or when visibility or assignee is locked`; `PRIVATE drops the assignee proposal`; `a horizon that disagrees with the proposed date is dropped` (date today + `DIESE_WOCHE` dropped; date in 10 days + `DIESE_WOCHE` dropped; date in 10 days + `SPAETER` kept; uses `horizonForDueDate`); `a description without a title is dropped`; `properties fold to the board's keys and drop a bad key or value per item`; `tags reuse the board's spelling by fold`; `a property or tag item past three is dropped`.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/assistant/captureProposal.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `captureCandidates` and `acceptCapture` (`acceptProperties` generalises today's `acceptReference` per item; `acceptTags` validates each against the note tag schema). Set `SUGGESTION_MAX_OUTPUT_TOKENS = 1024`.
- [ ] **Step 4: Run** the test file and `src/lib/assistant/suggestions.test.ts` if present. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): propose horizon, privacy, tags, properties and a description, with consistency rules`.

### Task 6: Keep, undo and the countdown for the new fields

**Files:**

- Modify: `apps/api/src/lib/assistant/suggestions.ts`
- Test: `apps/api/test/assistant-suggestions.test.ts` (route, one file)

**Interfaces:**

- Consumes: Task 2 contract, `suggestionOptInFieldKeys`.
- Produces: steps and writes:
  - `horizon` → `move_note { mode: 'HORIZON', horizon }`; undo → `HEUTE`; `stillWritten`: `note.horizon === written.horizon`.
  - `visibility` → `update_note { visibility: 'PRIVATE' }`; undo is two steps, `{ key: 'visibility' }` → `update_note { visibility: 'SHARED' }` then `{ key: 'visibility', index: 1 }` → `assign_note { assigneeId: null }` under `operationIds.visibility.undoAssignee`. `FieldValues` gains `visibility: NoteVisibility` and `privateAssigneeId: string | null` (written: the actor's id; restored: `null`); `stillWritten` compares `note.visibility` and `note.assignee?.id ?? null` respectively. `proposedValues` takes the actor id.
  - `tags` → one `update_note { tagChanges: { add } }` with the kept items; undo `{ tagChanges: { remove } }` of those still present.
  - `properties` → one `update_note { fieldChanges: { set } }` with the kept items; undo `{ fieldChanges: { remove } }` of the keys still holding the written values.
  - `description` → `update_note { description }`; undo `''` while the note still holds the written text.
  - `decideSuggestion`: the countdown never keeps a key in `suggestionOptInFieldKeys`; "a proposal holding nothing but a title runs no countdown" becomes "nothing but opt-in fields". `tags` / `properties` indexes are handled exactly like `links` (unique, in range, ascending; none left drops the field).
  - `toDto` fills `horizon`, `visibility`, `tags`, `properties`, `description` and `kept.tags` / `kept.properties` (`[]` when absent).
  - `mintOperationIds` mints the new ids.

- [ ] **Step 1: Write failing route tests:**
  - `keeps a horizon through move_note and the undo moves the note back to Today`
  - `keeps Private on the author's note, and the undo leaves it shared and unassigned`
  - `keeps two of three tags and one of two properties, and the undo removes exactly those`
  - `keeps a description only with the person's click, and the undo empties it`
  - `the countdown keeps the date and tags but never Private, the title or the description`
  - `a countdown with only opt-in fields ticked writes nothing and the record stays pending`
  - `a pending record stored before this release (reference, no new fields) still reads, keeps its property and undoes it` (write the record directly in the old shape)
  - `a keep refused part way through the new steps puts back what it wrote` (follow the pattern of the test at line 976)
- [ ] **Step 2: Run** the route file (emulator, one file). Expected: the new tests FAIL, the rest PASS.
- [ ] **Step 3: Implement** the steps, writes, `operationId` for `{ key: 'visibility', index: 1 }`, the undo order (`stepsFor(...).reverse()` with the visibility pair in the order above), the countdown rule and `toDto`.
- [ ] **Step 4: Run** the route file again. Expected: PASS, every existing test included.
- [ ] **Step 5: Run** `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint`. Expected: clean.
- [ ] **Step 6: Commit** `feat(api): keep and undo the new suggestion fields; the countdown leaves opt-in fields to the person`.

### Task 7: What the capture card locks

**Files:**

- Modify: `apps/web/src/features/board/Capture/useCapture.ts` (placement type), `Capture/InlineCaptureCard.tsx` (`locked()`), `WallView/WallView.tsx:439`, `AppShell.tsx` (`newNote`, props), `util/permissions.ts`, `ListView/ListView.tsx`, `WallView/WallView.tsx` props
- Test: `Capture/InlineCaptureCard.test.tsx` (or the existing capture test file that covers `locked`)

**Interfaces:**

- Produces: zone placement gains `picked: boolean` (`true` from `WallView`'s zone click and lane `+`, `false` from `AppShell.newNote`); `BoardAccess` gains `visibilityChosen: boolean` (`filter === 'shared'`); `InlineCaptureCard` prop `visibilityChosen?: boolean`. `locked()` adds `horizon` when `placement.kind === 'zone' && placement.axis === 'horizon' && placement.picked`, and `visibility` when `visibilityChosen`.

- [ ] **Step 1: Write failing tests:** `locks horizon for a column the person picked, not for the New note button's default column`; `locks visibility for a note written under the Shared filter`; `locks nothing new in the list or on the free canvas`.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement** the placement flag, the access flag and the props through `AppShell` → `WallView` / `ListView` → `InlineCaptureCard`.
- [ ] **Step 4: Run** the test file and `src/features/board/Capture`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): lock the horizon of a picked column and the visibility chosen by the Shared filter`.

### Task 8: Suggestion state: 15 s, opt-in fields, items, cross-out

**Files:**

- Modify: `apps/web/src/features/board/Suggestions/useSuggestions.ts`, `Suggestions/pendingProps.ts`, `Suggestions/usePendingFor.ts`
- Test: `Suggestions/useSuggestions.test.tsx`, `Suggestions/pendingProps.test.ts`

**Interfaces:**

- Consumes: `suggestionOptInFieldKeys`, `SuggestionDto` (Task 2).
- Produces:
  - `COUNTDOWN_MS = 15_000`.
  - `SuggestionMark` gains `tags: number[]`, `properties: number[]`; controller gains `setTag(noteId, index, on)`, `setProperty(noteId, index, on)`; `PendingProps` gains `onSetTag`, `onSetProperty`.
  - Initial change = every proposed field except the opt-in keys (generalises today's title-only rule); `countsDown` = the change holds a non-opt-in key.
  - `setField(noteId, 'title', on)` also sets `description` when one is proposed (taken together); ticking any opt-in key stops the countdown, as ticking the title does today.
  - `remove` (the row's ×) and the last item out no longer discard: with nothing left the countdown stops and the record stays pending until Keep, Undo, Enter or Esc. Keep with nothing in the change discards.
  - `proposedValues` keeps its kept-phase role only (values in their places until the refetch); the pending phase is drawn by Task 9's list.
  - New pure helper `proposalRows(note: NoteDto, mark: SuggestionMark): ProposalRow[]` in `Suggestions/proposalRows.ts` with `type ProposalRow = { id: string; field: SuggestionFieldKey; index?: number; on: boolean; reason: string } & ({ kind: 'date'; iso: string } | { kind: 'priority'; value: 'HOCH' | 'NIEDRIG' } | { kind: 'horizon'; value: 'DIESE_WOCHE' | 'SPAETER' } | { kind: 'person'; user: UserSummary } | { kind: 'private' } | { kind: 'property'; key: string; value: string } | { kind: 'tag'; value: string } | { kind: 'step'; text: string } | { kind: 'link'; title: string })`, ordered: date, horizon, priority, person, private, properties (legacy `reference` as one property row), tags, steps, links. Every proposed item is a row; `on` says whether it is in the change.

- [ ] **Step 1: Write failing tests:** `counts down 15 s`; `starts with everything but title, description and Private in the change`; `ticking Private or the title stops the countdown, and the title brings the description with it`; `crossing out the last row stops the countdown and keeps the record pending`; `keep with nothing left discards`; `setTag and setProperty tick items in and out and send their indexes with the keep`; `proposalRows lists every proposed item in order, crossed-out ones with on: false`.
- [ ] **Step 2: Run** `pnpm vitest run src/features/board/Suggestions`. Expected: the new tests FAIL; update the existing tests that assert 6 s or "last × discards" to the new rules (they are the spec change, not regressions).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run src/features/board/Suggestions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): fifteen-second countdown, opt-in fields, tag and property items, cross-out instead of discard`.

### Task 9: The pending card from Paper Wall v3 (wall and list)

**Files:**

- Create: `apps/web/src/features/board/Suggestions/ProposalList.tsx`, `Suggestions/ReviewFooter.tsx`, `Suggestions/CountdownRing.tsx` (extracted from `PendingDot.tsx`), tests beside each
- Modify: `Suggestions/PendingDot.tsx` (uses `CountdownRing`), `WallView/NoteCard.tsx`, `ListView/NoteRow.tsx`, `NoteDetail/PendingReview.tsx`, `apps/web/src/styles/board-shell.css` (row reveal keyframes), `apps/web/src/i18n/de.ts`, `en.ts`, `docs/BRAND.md` ("## AI" rule 3), `docs/rfcs/0005-wallybot-inline.md` (§3.3)

**Interfaces:**

- Consumes: `proposalRows`, `PendingProps` (Task 8).
- Produces: `ProposalList({ note, pending }: { note: NoteDto; pending: PendingProps })`; `ReviewFooter({ mark, onKeep, onUndo }: { mark: SuggestionMark; onKeep: () => void; onUndo: () => void })`; `CountdownRing({ mark, size }: { mark: DotMark; size: number })`.

Behaviour (spec §5, all of it in these components):

- `asking`: footer reads the "filling in" string, no ring, no buttons; no list.
- `pending`: list rows, each a hairline-separated row with a small `bg-accent` dot, label (`--fg-meta-on-note`), value, and a `×` button (`aria-pressed` reflects `on`; crossed out: `line-through`, ~45% opacity, the button shows `↺` with the "bring back" label). Private starts crossed out. Reason is the row's `title` and `aria-description`. Rows enter with `opacity` + `translateY(4px)` over 150 ms, `animation-delay: index × 100ms`, `motion-reduce:animate-none`.
- Footer: `CountdownRing`, "Saves in {{count}} s" (updates each second while running) or "Paused" or nothing when no countdown runs; **Undo** (outline button, calls `onDiscard`) and **Keep** (`--primary` filled button; with nothing in the change it discards). Pointer/focus inside the card pauses as today (`usePendingPause`).
- The done checkbox is hidden (`invisible`, not removed, so layout does not jump) while `asking` or `pending`.
- The corner `PendingDot` stays. The offered title line stays as today (R2); the offered description renders under it in the same taken/not-taken state.
- `kept` phase: no list, no footer; in-place values via `proposedValues` as today.
- `NoteRow`: while `asking` or `pending` the row becomes two-part (main line as today; under it, aligned with the title, the `ProposalList` and `ReviewFooter`); otherwise unchanged.
- `PendingReview`: the "Added by Wallybot" group gains rows for horizon, Private (unticked), each tag, each property and the description (with the title).
- Copy (de / en): labels `Fällig`/`Due`, `Priorität`/`Priority`, `Wann`/`When`, `Person`/`Person`, `Privat`/`Private`, `Tag`/`Tag`, `Schritt`/`Step`, `Verknüpft`/`Related`; horizon values reuse the existing horizon enum labels; footer `Wird ausgefüllt …`/`Filling in…`, `Speichert in {{count}} s`/`Saves in {{count}} s`, `Pausiert`/`Paused`, `Behalten`/`Keep`, reuse the existing undo string for Undo; row button labels `Weglassen`/`Leave out` and `Wieder aufnehmen`/`Bring back`. Reuse an existing key where one already says the same.

- [ ] **Step 1: Write failing component tests:** `ProposalList`: `renders one row per proposed item in order`, `× crosses a row out and ↺ brings it back through the pending callbacks`, `Private starts crossed out`, `rows carry their reason as accessible description`; `ReviewFooter`: `shows Filling in while asking`, `counts down whole seconds and shows Paused when paused`, `Keep keeps, Undo discards, Keep with nothing left discards`; `NoteCard` and `NoteRow`: `a pending change shows the list and the footer and hides the done checkbox`, `a kept change shows neither`.
- [ ] **Step 2: Run** the new and touched test files. Expected: FAIL.
- [ ] **Step 3: Implement** the components, wire them into `NoteCard` and `NoteRow` (remove the pending-phase in-place `ProposedField`s there; keep the title line and the kept-phase values), add the review panel rows, the CSS keyframes and the copy.
- [ ] **Step 4: Amend docs:** BRAND.md "## AI" rule 3 (the pending card may show a labelled list of the proposed fields and a review footer with the countdown, Undo and Keep, until kept or undone; nothing else changes); RFC §3.3 (fields as a list, 15 s, the footer).
- [ ] **Step 5: Run** `pnpm vitest run src/features/board src/i18n src/brandGuards.test.ts src/englishIdentifiers.test.ts`, then `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint`. Expected: PASS and clean.
- [ ] **Step 6: Commit** `feat(web): show a proposal as a labelled list with a countdown footer, on the wall and in the list`.

### Task 10: E2E

**Files:**

- Create: `apps/web/e2e/capture-review.spec.ts`

- [ ] **Step 1: Write the spec** (starts with `test.skip(!hasE2eCredentials, ...)` like the others), two tests:
  - `with the assistant off, a note written in the list or on the wall shows no review and stays checkable` (real stack).
  - `with a stubbed proposal, the card and the list row show the rows and the footer, × and ↺ work, Undo discards`: stub with `page.route` the board read (set `assistantEnabled: true` on the real response), `POST …/assistant/captures` (a fixed `SuggestionDto` with date, horizon, tags, Private) and the decision call (echo the record as `DISCARDED`). Assert row labels, Private crossed out, the footer's seconds label, and that Undo removes list and footer. If stubbing the board read proves impractical in this app, say so in the task report and keep only the first test; component tests and the live pass carry the rest.
- [ ] **Step 2: Run** locally only if the E2E setup in `apps/web/e2e/README.md` allows it without the owner's credentials; otherwise it runs in CI after the owner's OK. Do not count a local skip as a pass.
- [ ] **Step 3: Commit** `test(e2e): cover the capture review card`.

### Task 11: Verify, owner review, then deliver

- [ ] **Step 1: Repo checks.** Shared build, API and web typecheck and lint, `pnpm format:check`, the guard tests listed in the handoff, every API unit test under `src`, and every API route test file that touches notes or the assistant, **one file at a time**. Expected: all pass.
- [ ] **Step 2: Whole-branch review** by a fresh reviewer against the spec and this plan; one fix wave; re-run Step 1.
- [ ] **Step 3: Preview.** Run the branch beside the live stack with `.env.preview` on free ports (pick ports not in `.claude/launch.json`), `ASSISTANT_ENABLED=true`. The owner signs in.
- [ ] **Step 4: Live pass, wall.** In Paper Wall and Minimal, light and dark, at desktop and a phone width: write a clearly marked test note; see "Filling in…", rows arriving one by one, the 15 s footer; check ×/↺, Keep, Undo, Enter, Esc; Private and the title stay opt-in; a kept This week moves the card on the horizon wall and Undo moves it back.
- [ ] **Step 5: Live pass, list view** (the owner's report). Write a clearly marked test note in the list: the pending row must appear where the person can see it, its rows and footer readable, the countdown running, Keep and Undo working. If it fails, diagnose with superpowers:systematic-debugging and fix on this branch (test first) before going on. Delete every test note afterwards.
- [ ] **Step 6: Owner's final scoring run.** Ask the owner to run the scoring command on the branch tip; record the summary under "Results". Ready requires: better than the baseline overall and zero anti-goal failures. If not, report the failing fixtures and stop for the owner's call.
- [ ] **Step 7: Owner review.** Hand over the branch diff (`git diff origin/main...feat/smarter-capture`), the preview and the results. **Wait for an explicit OK.**
- [ ] **Step 8: Deliver after the OK only.** Push, open one PR against `main` (body: Summary, Decisions, Verification, Results, Deferred), bind it in the app, read CI; it is ready only with CI green, E2E included.

## Results

Baseline (owner's run on `ae52025b`, 2026-10-18, `vertex:gemini-2.5-flash`): **30 of 70 scored
fields right, anti-goal failures: none.**

| field       | right | wrong | missed | extra |
| ----------- | ----: | ----: | -----: | ----: |
| dueDate     |     8 |     0 |      0 |     2 |
| assignee    |     7 |     0 |      0 |     3 |
| priority    |     5 |     0 |      3 |     0 |
| properties  |     3 |     4 |      3 |     0 |
| horizon     |     0 |     0 |      4 |     0 |
| tags        |     1 |     0 |      8 |     0 |
| visibility  |     4 |     0 |      3 |     0 |
| subtasks    |     2 |     0 |      4 |     0 |
| title       |     0 |     0 |      3 |     0 |
| description |     0 |     0 |      3 |     0 |

Final run (owner's run on the branch tip, 2026-10-19, `vertex:gemini-2.5-flash`): **64 of 68
scored fields right, anti-goal failures: none.** One fixture (`steps-onboarding`) was not scored:
its call hit a Vertex 429 (resource exhausted). The private-tag fixture now scores one `leaks`
field instead of two, so the total is 68 + 1 unscored fixture against the baseline's 70.

| field       | right | wrong | missed | extra |
| ----------- | ----: | ----: | -----: | ----: |
| dueDate     |    10 |     0 |      0 |     0 |
| assignee    |     8 |     0 |      0 |     2 |
| priority    |     7 |     0 |      1 |     0 |
| properties  |     8 |     0 |      1 |     0 |
| horizon     |     4 |     0 |      0 |     0 |
| tags        |     8 |     0 |      0 |     0 |
| visibility  |     7 |     0 |      0 |     0 |
| subtasks    |     5 |     0 |      0 |     0 |
| title       |     3 |     0 |      0 |     0 |
| description |     3 |     0 |      0 |     0 |
| leaks       |     1 |     0 |      0 |     0 |

Remaining misses: a recipient proposed as assignee ("Send Ben the slides", "Reply to Anna"), a
new property key not proposed (`props-new-key`), "sometime" not read as low priority.

---

## Revision tasks (2026-10-19, spec "Revision: the review card follows Paper Wall v3")

### Task 12: Title and description join the change; Keep is always active

- `packages/shared/src/schemas/assistant.ts`: `suggestionOptInFieldKeys = ['visibility']`.
- API `decideSuggestion`: the countdown keeps title and description; route tests that pinned
  "the countdown never keeps a title" now pin that it does, and that it never keeps Private.
- Web `useSuggestions`: initial change = every proposed field but Private; `remove('title')`
  unticks title and description (no permanent dismissal); `keep` with nothing ticked discards
  (`source` as given); `pendingKeys` Enter with nothing ticked keeps (so discards).
- `ReviewFooter`: Keep never disabled.

### Task 13: Rows from the mockup

- `proposalRows(note, mark)`: a Title row first (field `title`, value the cleaned title); typed
  rows from `suggestion.typed` with the note's current values and `fixed: true` (no toggle);
  steps stay rows of kind `step` but the list renders them as a checklist after the rows.
- `ProposalList`: mockup row layout (label 60px, value wraps, no truncation to a sliver), steps
  as a checklist with `×`/`↺`, fixed rows without a button.

### Task 14: One card on the wall

- `NoteCard`/`RestingNoteCard`: while `asking` or `pending`, an outer `div.paper-note-review-card`
  carries the glow, the fill, the hover lift and a `:has(:focus-visible)` ring; inside it the
  card's `<button>` (borderless) and the review as siblings. Title swap and description swap,
  shimmer and "Filling in" while asking, meta line hidden, done circle hidden, no corner dot.
  Outside review the card is unchanged.
- CSS in `board-shell.css`: `@property --capture-angle`, the spin, the shimmer, the pulse, all
  off under reduced motion.

### Task 15: The list row and the panel

- `NoteRow`: the same container pattern and content while reviewing.
- `PendingReview`: the same `ProposalList` and `ReviewFooter`; the grouped checkboxes go.

### Task 16: Docs, E2E, verification

- BRAND.md "## AI" amendments; RFC §3.3 note; E2E spec updated to the new card.
- Full suite; route files one at a time.
- Side by side with the mockup on :5300 and the preview on :5250 with everyday notes ("call
  doctor tomorrow…", "remind the team…"), wall and list, before handing over.

## Revision tasks (2026-10-19 (2), spec "editing the text asks again")

### Task 17: Ask again after a finished edit

- `lib/mutationQueue.ts`: `whenSettled(resource)` resolves once the lane is idle.
- `useSuggestions.request(noteId, locked, options?: { after?: () => Promise<void> })`: shows
  "asking" at once, calls the API after `after()`; a newer request or Esc wins as today.
- `Suggestions/editAsk.ts`: `EDIT_LOCKED = ['title','description','horizon']`, `editAskAllowed(note,
userId, enabled)` (own, OPEN), `textChanged(before, after)`.
- Tests: request waits for `after`; Esc during the wait sends nothing; helpers' cases.

### Task 18: The sidebar asks again and looks like the card

- `NoteDetailPanel`: edit session over both text fields (focus in → snapshot, focus out of both
  or unmount → `onTextEdited` when changed); title/description show the cleaned text while the
  Title row is on; title shimmers while asking.
- `PendingReview`: the card's glow, `ProposalList` and `ReviewFooter` (asking and pending), Undo
  pill when kept. AppShell wires `onTextEdited` → request with `EDIT_LOCKED`, after the lane.
- Tests: panel edit asks once with the locks; unchanged edit asks nothing; review renders the
  footer while asking.

### Task 19: Edit in place on the wall and the list

- `Capture/captureField.tsx`: `MirroredField`, `fitToContent`, `withoutDropped` moved out of
  `InlineCaptureCard` (no behaviour change).
- `Capture/InlineNoteEditor.tsx`: the editor (prefill, chips, Enter/⌘Enter/Esc/blur, writes via
  update/move/assign hooks, then `onDone`).
- `Suggestions/useInlineEdit.ts` → `editFor(noteId)` (`editing`, `start`, `done`); threaded like
  `pendingFor` through WallView, WallCanvas, ZoneBands, ListView into NoteCard and NoteRow;
  double-click, F2, title click under review; ZoneBands double-click ignores cards.
- Tests: editor unit tests (prefill with cleaned title, Esc writes nothing, unchanged Enter
  writes nothing, chip kept → locked); NoteCard/NoteRow start the edit on double-click and F2.

### Task 20: E2E, suite, live check

- `e2e/capture-review.spec.ts`: inline edit of a reviewed note shows "Filling in" and a new
  review and sends the title locked; sidebar edit does the same.
- Full suite, live check on :5250 (wall, list, sidebar).
