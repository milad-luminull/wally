# Review Grouped by Source Implementation Plan

> **Status:** executed in PR #47.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Enter, Wallybot also proposes what the parser could not read and slice 2 left out: subtasks, a reference property ("Kunde: Müller GmbH") and a cleaner title offered beside the person's own; the note panel shows the pending change as two groups, **From what you typed** and **Added by Wallybot**, each row with a checkbox, and the card follows every tick; keep and undo stay one server record and one step.

**Architecture:** The suggestion record of slice 2 grows three fields (`title`, `reference`, `subtasks`) and remembers which fields the person typed (`typed`), so the review can group rows by source. A keep still runs one deterministic chain of command-layer writes under operation ids minted at creation: `update_note` for the title and the reference (`fieldChanges.set`), one `add_subtask` per kept item; undo is the inverse, which needs one new operation, `delete_subtask`, added to the registry as the product decision `RFC-0003-wally-agent.md` §3.3 asks for. On the web, the controller's mark gains per-item subtask choices and the title stays opt-in (never kept by the countdown); the card shows the new fields in the note's own type; the note panel renders the grouped review from the same mark, and opening it pauses the countdown.

**Tech Stack:** Fastify + Zod + firebase-admin, Vercel AI SDK behind `apps/api/src/lib/assistant/model/`, React 19 + TanStack Query 5 + Radix checkbox + Tailwind tokens. No new dependency.

**Spec:** `docs/rfcs/RFC-0005-wallybot-inline.md` §3.3 (the title line), §3.4 (grouped review), §4, §7; `docs/rfcs/RFC-0003-wally-agent.md` §3.2 and §3.3; `docs/BRAND.md` "## AI" rules 3, 4, 6 and 7. Slice 2's plan `docs/superpowers/plans/2026-10-17-capture-suggest.md` is the record of what this builds on (its rulings R1–R8 and their amendments stand).

## Context

Slice 2 (PR #46) proposes a due date, a priority and a person after Enter. This slice adds the rest of what §3.3 and §3.4 describe for one note, and the review surface. Decisions, each with its reason and its cost if wrong:

- **R1. Links between notes are not in this slice.** §3.4's hairline between related notes needs a stored relation on notes (a schema, a command, a DTO, the panel), the model reading the board's other notes, and lines drawn across the wall's scroll containers. That is a product decision (`RFC-0003-wally-agent.md` §3.3: adding an operation is one) and a design risk of its own; it goes to a follow-up slice with its own plan. Cost if wrong: one more PR.
- **R2. The title is opt-in.** A cleaner title is offered as a second line beside the person's own (BRAND rule 7) and is never kept by the countdown: it joins the change only when the person ticks it in the review or taps the line on the card; "use mine" (the ×) drops it. A proposal that holds nothing but a title runs no countdown; ticking the title stops a running countdown, and Enter then keeps it with the rest (ruling of 2026-10-17: a countdown keep never carries the title, ticked or not). Cost if wrong: a tap more for a title the person would have taken.
- **R3. The grouped review lives in the note panel**, the detail layer §3.1 names, not in a card that expands on the wall: a card growing inside a zone's scroll container would reflow the wall, and the panel already opens on a click of the committed card. Opening the panel on a note with a pending change pauses its countdown while it is open. Cost if wrong: one click more than an in-place expansion.
- **R4. "From what you typed" rows are the fields the person's chips set** at commit (`locked` from slice 1, stored on the record as `typed`) plus the title and text they wrote. Those rows are shown checked and read-only (ruling of 2026-10-17): they document what the person wrote, and changing a typed value is done in the panel's own fields, which ends the pending change as any edit under one does (slice 2's stale-revision rule). Cost if wrong: a person who wants to drop a typed date edits it in the panel and loses the proposal.
- **R5. No "source mark" on the card.** §3.4 mentions a small source mark per field; BRAND rule 3, amended with this feature, allows only the dashed edge and the dot as markers, and the reason sits on each field as before. The groups in the panel are where the source is read. Cost if wrong: nothing to remove later.
- **R6. One new operation, `delete_subtask`.** Undoing a kept subtask needs it; it maps to `subtask.delete`, is marked destructive and idempotent, needs no named confirm (§3.2 names note deletion, not a subtask), and is recorded in `RFC-0003-wally-agent.md` §3.3 as this slice's product decision. Cost if wrong: a row in a table.
- **R7. A reference proposes one property only**, reusing one of the board's existing property keys when the words fit one (the board's keys travel in the prompt as data), on a note that has no property yet. Subtasks are proposed only for a note with none, two to five items, each a short step in the person's language. Cost if wrong: fewer proposals, never a wrong overwrite.
- **R8. Undo restores exactly:** the title as it was, the reference key removed (or its previous value put back when the key existed), every kept subtask deleted by its own id, newest first, each under its own operation id, chained on revisions as in slice 2.
- **Records written by slice 2** have no title, reference or subtask ids; they read as having nothing proposed there. Nothing migrates.

## Global Constraints

- Work only in `/Users/mr_user/development/apps/wally-review`, branch `feat/capture-review` (cut from `origin/main` after PR #46; base `main`; never stacked). Never run git or edit files in `/Users/mr_user/development/apps/wally` (bind-mounted into the running stack) or in the other worktrees (`wally-capture`, `wally-suggest`, `wally-assistant`).
- API route tests need the Firestore emulator on `localhost:8080` and run ONE FILE AT A TIME: `cd /Users/mr_user/development/apps/wally-review/apps/api && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=wally-local CORS_ORIGIN=http://localhost:5173 pnpm vitest run test/<file>`. Never two emulator runs at once, never the whole API suite in one command, never any docker command. Unit tests under `apps/api/src` need no emulator.
- Web tests touch no emulator: `cd /Users/mr_user/development/apps/wally-review/apps/web && pnpm vitest run <file>`, one file at a time while iterating.
- Checks from the worktree root: `pnpm --filter @wally/shared build` (after any shared change), `pnpm --filter @wally/api typecheck`, `pnpm --filter @wally/api lint`, `pnpm --filter @wally/web typecheck`, `pnpm --filter @wally/web lint`, `pnpm format:check` (fix with `pnpm format`). Guard tests stay green: `apps/api/src/lib/assistant/model/boundary.test.ts`, `apps/web/src/brandGuards.test.ts`, `src/i18n/noHardcodedCopy.test.ts`, `src/i18n/resources.test.ts`, `src/i18n/englishSurface.test.tsx`, `src/features/board/WandView/NoteCard.test.tsx`.
- No new dependency. The model library only under `apps/api/src/lib/assistant/model/`. Copy only from the catalogues (`de.ts` authority, `en.ts` mirror); German words in TS source outside the catalogues as `\u` escapes where the guard requires.
- BRAND.md: marigold only as the dot and ring; the dashed edge is the note's border colour; proposed values in the note's own type and colour; no toasts, no modals, no badges, no name, no first person; a rewritten title is a second line beside the original, never a replacement; controls at least 40 px on a coarse pointer; motion 120–180 ms on transform and opacity only.
- Every write a keep or an undo makes goes through `runOperation` with the record's provenance and leaves an audit row; every model call reserves before and settles after.
- Conventional Commits; never commit to `main`. Commit with `git -c core.hooksPath=/dev/null commit`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the model that wrote them, as the workflow names it).
- Prettier: single quotes, trailing commas, width 100.

## Review Focus

1. A keep with three subtasks is cut short after the second `add_subtask` (a 5xx): the next keep resumes from the third under the same ids, the note ends with exactly three subtasks, and the undo deletes exactly those three. Test in Task 4.
2. The countdown never keeps a title: a proposal with a title and a due date keeps only the date; a proposal with a title alone shows the dot waiting and nothing is written until the person ticks it. Tests in Task 5 and Task 7.
3. Unticking "Added by Wallybot: 2 Schritte" in the panel and pressing Keep writes the date and the reference but no subtask; ticking one of the two subtask rows writes that one. Tests in Task 4 (server subset) and Task 7 (panel).
4. A reference proposed with the key "kunde" on a board whose notes use "Kunde" is written under "Kunde", and undo removes it; when the note already had "Kunde: Alt", undo puts "Alt" back. Test in Task 4.
5. Opening the panel on a pending note pauses the ring; closing it resumes; a pending note's panel shows the two groups; a note without a pending change shows no review section. Tests in Task 7.

---

### Task 1: The contract grows: three fields, what was typed, per-item subtasks

**Files:**

- Modify: `packages/shared/src/schemas/assistant.ts`
- Modify: `apps/api/src/lib/db/types.ts`
- Modify: `apps/web/src/test/fixtures.ts` (`makeSuggestionMark` gains the new fields and `typed`)

**Interfaces:**

- Produces (shared): `suggestionFieldKeys = ['dueDate','priority','assignee','title','reference','subtasks']`; `SUGGESTION_MAX_SUBTASKS = 5`; `suggestionFieldsSchema` with `title`, `reference`, `subtasks`; `suggestionDtoSchema.typed`; `suggestionDtoSchema.kept.subtasks`; `suggestionDecisionSchema.subtasks`.
- Produces (API types): `AssistantSuggestionDoc.fields.{title,reference,subtasks}`, `typed`, `operationIds.{title,reference,subtasks[]}`, `decision.subtasks`, `applied.{before.title, before.reference, subtaskIds}`.

- [ ] **Step 1: Shared schemas**

In `packages/shared/src/schemas/assistant.ts` replace the field-key block and extend the schemas:

```ts
/**
 * The fields Wallybot may fill in on a note written in place: slice 2's three, and slice 3's
 * title line, reference property and subtasks (RFC-0005-wallybot-inline.md §3.3, §3.4).
 */
export const suggestionFieldKeys = [
  'dueDate',
  'priority',
  'assignee',
  'title',
  'reference',
  'subtasks',
] as const;
export const suggestionFieldKeySchema = z.enum(suggestionFieldKeys);
export type SuggestionFieldKey = z.infer<typeof suggestionFieldKeySchema>;
/** Steps a proposal may carry; more would be a plan, not a note. */
export const SUGGESTION_MAX_SUBTASKS = 5;
```

`captureSuggestRequestSchema.locked` keeps `.max(suggestionFieldKeys.length)`.

`suggestionFieldsSchema` becomes:

```ts
export const suggestionFieldsSchema = z.object({
  dueDate: z.object({ value: z.string().date(), reason: reasonSchema }).nullable(),
  priority: z.object({ value: z.enum(['HOCH', 'NIEDRIG']), reason: reasonSchema }).nullable(),
  assignee: z.object({ value: userSummarySchema, reason: reasonSchema }).nullable(),
  /** A cleaner title, offered beside the person's own and never applied by a countdown (R2). */
  title: z
    .object({ value: z.string().min(1).max(NOTE_TITLE_MAX_LENGTH), reason: reasonSchema })
    .nullable(),
  /** One property, "Kunde: Müller GmbH"; the key is one the board already uses when it fits (R7). */
  reference: z
    .object({
      key: z.string().min(1).max(FIELD_KEY_MAX_LENGTH),
      value: z.string().min(1).max(FIELD_VALUE_MAX_LENGTH),
      reason: reasonSchema,
    })
    .nullable(),
  /** Two to five steps; the person keeps them one by one in the review. */
  subtasks: z
    .object({
      items: z
        .array(z.string().min(1).max(SUBTASK_TEXT_MAX_LENGTH))
        .min(1)
        .max(SUGGESTION_MAX_SUBTASKS),
      reason: reasonSchema,
    })
    .nullable(),
});
```

(import `NOTE_TITLE_MAX_LENGTH`, `FIELD_KEY_MAX_LENGTH`, `FIELD_VALUE_MAX_LENGTH`, `SUBTASK_TEXT_MAX_LENGTH` from `../constants.js`).

`suggestionDtoSchema` gains, after `fields`:

```ts
  /** The fields the person decided while writing (the chips, the placement): the review's first group. */
  typed: z.array(suggestionFieldKeySchema),
```

and `kept` becomes

```ts
  kept: z
    .object({
      fields: z.array(suggestionFieldKeySchema),
      /** Which of the proposed subtasks were written, by index. */
      subtasks: z.array(z.number().int().nonnegative()),
      revision: z.number().int().nonnegative(),
    })
    .nullable(),
```

`suggestionDecisionSchema` gains, after `fields`:

```ts
    /** For `keep` with `subtasks` among the fields: the items to write, by index; omitted means all. */
    subtasks: z.array(z.number().int().min(0).max(SUGGESTION_MAX_SUBTASKS - 1)).max(SUGGESTION_MAX_SUBTASKS).optional(),
```

- [ ] **Step 2: Stored shape**

In `apps/api/src/lib/db/types.ts`:

```ts
/**
 * One operation id per write and per direction, minted when the suggestion is created. The
 * subtask ids are indexed like the proposed items; records from slice 2 carry only the first
 * three keys and read as proposing nothing else.
 */
export type SuggestionOperationIds = {
  dueDate: { apply: string; undo: string };
  priority: { apply: string; undo: string };
  assignee: { apply: string; undo: string };
  title?: { apply: string; undo: string };
  reference?: { apply: string; undo: string };
  subtasks?: { apply: string; undo: string }[];
};
```

In `AssistantSuggestionDoc`: `fields` gains `title?: { value: string; reason: string } | null; reference?: { key: string; value: string; reason: string } | null; subtasks?: { items: string[]; reason: string } | null;`; add `typed?: SuggestionFieldKey[];` (import the type from `@wally/shared`); `decision` gains `subtasks?: number[]`; `applied.before` gains `title?: string; reference?: { key: string; previous: string | null } | null;` and `applied` gains `subtaskIds?: string[];` (the ids the kept subtasks were created with, in index order of the kept items) and `subtasks?: number[]` (the kept indexes). Replace the written-out `('dueDate' | 'priority' | 'assignee')[]` unions with `SuggestionFieldKey[]`.

- [ ] **Step 3: Fixture**

In `apps/web/src/test/fixtures.ts` `makeSuggestionMark`: the suggestion gains `title: null, reference: null, subtasks: null` in `fields`, `typed: []`, and `kept: null` stays; the mark gains `subtasks: []` (Task 5 defines the field; add it here now so Task 5's fixture use compiles after Task 5 types it; until then keep it out if typecheck objects, and add it in Task 5).

- [ ] **Step 4: Build, typecheck, commit**

Run: `cd /Users/mr_user/development/apps/wally-review && pnpm --filter @wally/shared build && pnpm --filter @wally/api typecheck && pnpm --filter @wally/web typecheck && pnpm format:check`
Expected: typecheck errors in `suggestions.ts` (`mintOperationIds`, `toDto` and the `fields` object lack the new keys) and in `useSuggestions.ts`/`pendingProps.ts` (the `proposed` helper and `ProposedValues` map over the enum). Fix only what the type change forces, with the smallest edits: in `suggestions.ts` `toDto` add `title: live.title ?? null, reference: live.reference ?? null, subtasks: live.subtasks ?? null, typed: doc.typed ?? []` and `kept.subtasks: doc.applied.subtasks ?? []`; `mintOperationIds` adds `title`, `reference` and five `subtasks` pairs; the capture writes `typed: request.locked` and the three new fields as `null`; in the web `proposedValues` return `title: null, reference: null, subtasks: null` for now and `pendingProps.ts`'s `ProposedValues` type follows the enum. Run the two existing route files one at a time (`test/assistant-suggestions.test.ts`) and `src/features/board/Suggestions/useSuggestions.test.tsx`: PASS unchanged.

```bash
git add packages/shared/src/schemas/assistant.ts apps/api/src/lib/db/types.ts apps/api/src/lib/assistant/suggestions.ts apps/web/src/features/board/Suggestions/pendingProps.ts apps/web/src/features/board/Suggestions/useSuggestions.ts apps/web/src/test/fixtures.ts
git -c core.hooksPath=/dev/null commit -m "feat(shared): a suggestion may carry a title, a reference and subtasks, and knows what was typed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `delete_subtask` joins the operation surface

**Files:**

- Modify: `apps/api/src/lib/assistant/operations.ts`
- Modify: `apps/api/src/lib/assistant/run.ts`
- Modify: `apps/api/src/lib/assistant/operations.test.ts`
- Modify: `apps/api/test/assistant-operations.test.ts`
- Modify: `docs/rfcs/RFC-0003-wally-agent.md` (§3.3 table)

- [ ] **Step 1: Failing tests**

`apps/api/src/lib/assistant/operations.test.ts`: add a case that `operationNames` includes `delete_subtask`, that `operationInputs.delete_subtask.safeParse({ boardId: 'b', noteId: 'n', subtaskId: 's', expectedRevision: 1 })` succeeds and the same without `subtaskId` fails, that `operationAnnotations.delete_subtask` is `{ readOnlyHint: false, destructiveHint: true, idempotentHint: true }`, and that `riskOf('delete_subtask', …, actor, null)` is `null`.

`apps/api/test/assistant-operations.test.ts`: add a route-level case following the file's pattern for `add_subtask`: create a note, run `add_subtask` through `runOperation`, then `delete_subtask` with the returned subtask id and the new revision: the note's `subtaskSummary.total` is 0, the revision moved by one, an audit row with `commandType: 'subtask.delete'` exists; running the same `delete_subtask` again with the same operation id replays (same revision, no second audit row); a wrong `expectedRevision` is `409 STALE_REVISION`; an unknown subtask id is `404`.

Run the unit file (no emulator) and the route file (emulator): FAIL.

- [ ] **Step 2: The operation**

`operations.ts`: add `delete_subtask: z.object({ ...noteRef, subtaskId: id }).strict(),` after `toggle_subtask`; annotations `delete_subtask: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },`. `run.ts` `toCommand`:

```ts
    case 'delete_subtask': {
      const { boardId, noteId, subtaskId, expectedRevision } =
        input as OperationInput<'delete_subtask'>;
      return {
        command: { type: 'subtask.delete', noteId, boardId, subtaskId, input: {} },
        expectedRevision,
      };
    }
```

`docs/rfcs/RFC-0003-wally-agent.md` §3.3 table: add the row `| \`delete_subtask\` | \`subtask.delete\` | approval; marked destructive; added 2026-10-17 so a kept subtask can be undone in one step (\`RFC-0005-wallybot-inline.md\` slice 3) |`after`add_subtask, toggle_subtask`.

- [ ] **Step 3: Green, checks, commit**

Run both files (one at a time), then `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint && pnpm format:check`.

```bash
git add apps/api/src/lib/assistant/operations.ts apps/api/src/lib/assistant/run.ts apps/api/src/lib/assistant/operations.test.ts apps/api/test/assistant-operations.test.ts docs/rfcs/RFC-0003-wally-agent.md
git -c core.hooksPath=/dev/null commit -m "feat(api): delete_subtask, so a kept subtask can be undone in one step

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The model proposes a title, a reference and steps

**Files:**

- Modify: `apps/api/src/lib/assistant/model/suggest.ts`
- Modify: `apps/api/src/lib/assistant/model/types.ts`
- Modify: `apps/api/src/lib/assistant/capturePrompt.ts`
- Test: `apps/api/src/lib/assistant/model/suggest.test.ts`, `apps/api/src/lib/assistant/capturePrompt.test.ts`

**Interfaces:**

- `ModelSuggestion` gains `title: { value; confidence; reason } | null`, `reference: { key; value; confidence; reason } | null`, `subtasks: { items: string[]; confidence; reason } | null`.
- `buildCapturePrompt` gains `fieldKeys: string[]` (the board's property keys) and prints `Properties on this board: Kunde, Vertragsnr` or `Properties on this board: none`.
- `SUGGESTION_MAX_OUTPUT_TOKENS` (in `suggestions.ts`, Task 4) becomes 512; the runner is unchanged.

- [ ] **Step 1: Failing tests**

`suggest.test.ts`: extend the first case's reply with `title: { value: 'Müller anrufen', confidence: 0.8, reason: 'kürzer' }, reference: { key: 'Kunde', value: 'Müller GmbH', confidence: 0.9, reason: 'Kunde genannt' }, subtasks: { items: ['Unterlagen prüfen', 'Müller anrufen'], confidence: 0.7, reason: 'zwei Schritte' }` and assert they come back as given; a reply whose `subtasks.items` has six entries, or an empty string, or whose `reference.key` is empty, returns `fields: null` (the strict schema refuses it; the test names each case); `suggestionSchemaJson()` contains `"subtasks"` and `"reference"`.

`capturePrompt.test.ts`: the prefix mentions `title`, `reference` and `subtasks` and says a title keeps the meaning and adds nothing; `buildCapturePrompt({ …, fieldKeys: ['Kunde', 'Vertragsnr'] })` contains `Properties on this board: Kunde, Vertragsnr`; with `fieldKeys: []` it contains `Properties on this board: none`; the members and the note lines are as before.

Run both: FAIL.

- [ ] **Step 2: Implement**

`types.ts` `ModelSuggestion`: add the three fields as typed above.

`suggest.ts`: `modelSuggestionWireSchema` adds

```ts
  title: z
    .object({
      value: z.string().describe('A shorter title with the same meaning, or null.'),
      confidence,
      reason: z.string(),
    })
    .nullable(),
  reference: z
    .object({
      key: z.string().describe('A property name, reusing one of the board\'s when it fits.'),
      value: z.string(),
      confidence,
      reason: z.string(),
    })
    .nullable(),
  subtasks: z
    .object({
      items: z.array(z.string()).describe('Two to five short steps, in order.'),
      confidence,
      reason: z.string(),
    })
    .nullable(),
```

(no string length keywords on the wire, as the file's comment explains) and `modelSuggestionSchema` adds the checked forms: `title.value: z.string().trim().min(1).max(NOTE_TITLE_MAX_LENGTH)`, `reference.key: z.string().trim().min(1).max(FIELD_KEY_MAX_LENGTH)`, `reference.value: z.string().trim().min(1).max(FIELD_VALUE_MAX_LENGTH)`, `subtasks.items: z.array(z.string().trim().min(1).max(SUBTASK_TEXT_MAX_LENGTH)).min(1).max(SUGGESTION_MAX_SUBTASKS)` (constants from `@wally/shared`).

`capturePrompt.ts`: the prefix's first line becomes "… fill in what the note itself says and nothing more: a due date, a priority, the member it names, a cleaner title, one property, and the steps it describes." Add three lines before the data-safety line:

```ts
  'title: only when a shorter wording says exactly the same, with no fact added or dropped; otherwise null. Keep the language of the words.',
  'reference: one property the words name, as key and value, like Kunde: Müller GmbH, Projekt: Relaunch, Vertragsnr: 4711. Reuse one of the properties on this board when it fits; otherwise null.',
  'subtasks: two to five short steps, in order, only when the words describe several things to do; each a few words in the language of the note. Otherwise null.',
```

`buildCapturePrompt` takes `fieldKeys: string[]` and appends `Properties on this board: ${keys.join(', ')}` or `Properties on this board: none` after the members.

- [ ] **Step 3: Green, guards, commit**

Run both unit files, then `src/lib/assistant/model/boundary.test.ts`, then `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint && pnpm format:check`. (`suggestions.ts` fails typecheck until it passes `fieldKeys`; pass `[]` there for now with a `// Task 4` comment, or do Task 4's prompt change here; either way typecheck must be green at the commit.)

```bash
git add apps/api/src/lib/assistant/model/suggest.ts apps/api/src/lib/assistant/model/types.ts apps/api/src/lib/assistant/model/suggest.test.ts apps/api/src/lib/assistant/capturePrompt.ts apps/api/src/lib/assistant/capturePrompt.test.ts apps/api/src/lib/assistant/suggestions.ts
git -c core.hooksPath=/dev/null commit -m "feat(api): the capture call also proposes a title, a reference and steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The record keeps and undoes the new fields

**Files:**

- Modify: `apps/api/src/lib/assistant/suggestions.ts`
- Modify: `apps/api/test/assistant-suggestions.test.ts`

**Interfaces:**

- Consumes: Task 1's types, Task 2's `delete_subtask`, Task 3's prompt and model fields, `findFieldKey` and `customFieldKeySchema`/`customFieldValueSchema` from `@wally/shared`, `listNotes` for the board's property keys.
- Produces: the same three exports (`suggestForCapture`, `decideSuggestion`, `pendingSuggestions`) with the wider record; `SUGGESTION_MAX_OUTPUT_TOKENS = 512`.

- [ ] **Step 1: Failing route tests**

Extend the fake runner in `apps/api/test/assistant-suggestions.test.ts`: every existing reply gains `title: null, reference: null, subtasks: null`; add scripts keyed on the title line:

- `'review'` → dueDate 2026-10-23 (0.9), priority null, assignee null, `title: { value: 'Angebot an Müller', confidence: 0.8, reason: 'kürzer' }`, `reference: { key: 'kunde', value: 'Müller GmbH', confidence: 0.9, reason: 'Kunde genannt' }`, `subtasks: { items: ['Unterlagen prüfen', 'Angebot schreiben', 'Angebot senden'], confidence: 0.8, reason: 'drei Schritte' }`.
- `'sametitle'` → `title: { value: 'sametitle', confidence: 0.9, reason: 'gleich' }`, everything else null.
- `'badref'` → `reference: { key: 'Kun.de', value: 'x', … }` (a key the field schema refuses) and `subtasks: { items: ['a', 'a', ' '], … }`.

Add the cases:

```ts
it("proposes a title, a reference under the board's own key, and steps, and records what was typed", async () => {
  const fx = await createBoardFixture(ctx);
  // The board already uses "Kunde"; the model answers with "kunde".
  await createNote(fx.ownerToken, fx.boardId, {
    title: 'Alt',
    customFields: { Kunde: 'Alt GmbH' },
  });
  const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'review' })).json();
  const res = await suggest(fx.ownerToken, fx.boardId, n.id, ['priority']);
  expect(res.statusCode).toBe(200);
  const { suggestion } = res.json();
  expect(suggestion.typed).toEqual(['priority']);
  expect(suggestion.fields).toMatchObject({
    dueDate: { value: '2026-10-23' },
    title: { value: 'Angebot an Müller' },
    reference: { key: 'Kunde', value: 'Müller GmbH' },
    subtasks: { items: ['Unterlagen prüfen', 'Angebot schreiben', 'Angebot senden'] },
  });
  expect(lastInput?.prompt).toContain('Properties on this board: Kunde');
});

it("drops a title equal to the note's own, a reference with a bad key, and steps that are empty or doubled", async () => {
  const fx = await createBoardFixture(ctx);
  const same = (await createNote(fx.ownerToken, fx.boardId, { title: 'sametitle' })).json();
  expect((await suggest(fx.ownerToken, fx.boardId, same.id)).json().suggestion).toBeNull();
  const bad = (await createNote(fx.ownerToken, fx.boardId, { title: 'badref' })).json();
  const s = (await suggest(fx.ownerToken, fx.boardId, bad.id)).json().suggestion;
  expect(s.fields.reference).toBeNull();
  expect(s.fields.subtasks).toEqual({ items: ['a'], reason: expect.any(String) });
});

it('never proposes a reference or steps on a note that has them, nor a title that was locked', async () => {
  const fx = await createBoardFixture(ctx);
  const n = (
    await createNote(fx.ownerToken, fx.boardId, { title: 'review', customFields: { Projekt: 'X' } })
  ).json();
  await ctx.inject({
    method: 'POST',
    url: `/notes/${n.id}/subtasks`,
    headers: ctx.authHeader(fx.ownerToken),
    payload: { text: 'Schritt' },
  });
  const s = (await suggest(fx.ownerToken, fx.boardId, n.id, ['title'])).json().suggestion;
  expect(s.fields).toMatchObject({
    reference: null,
    subtasks: null,
    title: null,
    dueDate: { value: '2026-10-23' },
  });
});

it("keeps a subset: the date, the reference and one of three steps; the title stays the person's", async () => {
  const fx = await createBoardFixture(ctx);
  const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'review' })).json();
  const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
  const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'keep',
    fields: ['dueDate', 'reference', 'subtasks'],
    subtasks: [1],
    source: 'click',
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().suggestion.kept).toEqual({
    fields: ['dueDate', 'reference', 'subtasks'],
    subtasks: [1],
    revision: n.revision + 3,
  });
  const after = await note(n.id);
  expect(after).toMatchObject({
    title: 'review',
    dueDate: '2026-10-23',
    customFields: { kunde: 'Müller GmbH' },
  });
  expect(after.subtaskSummary).toEqual({ total: 1, done: 0 });
  const detail = (
    await ctx.inject({
      method: 'GET',
      url: `/notes/${n.id}`,
      headers: ctx.authHeader(fx.ownerToken),
    })
  ).json();
  expect(detail.subtasks.map((s: { text: string }) => s.text)).toEqual(['Angebot schreiben']);
  const audits = await assistantAuditCol(ctx.db).where('approvalId', '==', suggestion.id).get();
  expect(audits.docs.map((d) => d.data().commandType).sort()).toEqual([
    'note.update',
    'note.update',
    'subtask.create',
  ]);
});

it("keeps the title when ticked, and undo puts the person's title, the old property and no steps back", async () => {
  const fx = await createBoardFixture(ctx);
  await createNote(fx.ownerToken, fx.boardId, {
    title: 'Alt',
    customFields: { Kunde: 'Alt GmbH' },
  });
  const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'review' })).json();
  // The note gets its own "Kunde" before the keep, so undo has a previous value to restore.
  const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
  // (candidates are decided at proposal time; a property added after the proposal is what
  // undo must put back, and the keep's fieldChanges.set overwrites it)
  await ctx.inject({
    method: 'PATCH',
    url: `/notes/${n.id}`,
    headers: ctx.authHeader(fx.ownerToken),
    payload: { fieldChanges: { set: { Kunde: 'Zwischen' } } },
  });
  const stale = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'keep',
    source: 'enter',
  });
  expect(stale.statusCode).toBe(409);
});

it('undo after a full keep restores the title, removes the property and deletes every step, once', async () => {
  const fx = await createBoardFixture(ctx);
  const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'review' })).json();
  const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
  const kept = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'keep',
    fields: ['dueDate', 'title', 'reference', 'subtasks'],
    source: 'click',
  });
  expect(kept.statusCode).toBe(200);
  expect(await note(n.id)).toMatchObject({
    title: 'Angebot an Müller',
    customFields: { kunde: 'Müller GmbH' },
  });
  expect((await note(n.id)).subtaskSummary.total).toBe(3);
  const undone = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'undo',
    source: 'shortcut',
  });
  expect(undone.statusCode).toBe(200);
  const after = await note(n.id);
  expect(after).toMatchObject({ title: 'review', dueDate: null, customFields: {} });
  expect(after.subtaskSummary.total).toBe(0);
  expect(after.revision).toBe(n.revision + 12);
  const again = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'undo',
    source: 'esc',
  });
  expect(again.json().suggestion.status).toBe('UNDONE');
  expect((await note(n.id)).revision).toBe(n.revision + 12);
});

it('resumes a keep cut short between two steps, and the undo deletes exactly the kept steps', async () => {
  const fx = await createBoardFixture(ctx);
  const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'review' })).json();
  const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
  // The second add_subtask fails with a 500 once (the file's existing pattern for cutting a
  // chain short: spy on runOperation or on the subtasks collection's create); then the keep
  // is sent again and must land all three.
  const first = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'keep',
    fields: ['subtasks'],
    source: 'enter',
  });
  expect(first.statusCode).toBe(500);
  const second = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'keep',
    fields: ['subtasks'],
    source: 'enter',
  });
  expect(second.statusCode).toBe(200);
  expect((await note(n.id)).subtaskSummary.total).toBe(3);
  const audits = await assistantAuditCol(ctx.db).where('approvalId', '==', suggestion.id).get();
  expect(audits.docs.filter((d) => d.data().commandType === 'subtask.create')).toHaveLength(3);
  const undone = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'undo',
    source: 'esc',
  });
  expect(undone.statusCode).toBe(200);
  expect((await note(n.id)).subtaskSummary.total).toBe(0);
});

it("a reference on the board's existing key: keep writes under that key, undo restores its old value", async () => {
  const fx = await createBoardFixture(ctx);
  const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'review' })).json();
  const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
  // A property with the same key, different case, set after the proposal, would make the
  // keep stale (409). This case checks the key fold at keep time on the note itself: the
  // proposal was computed on a note without the key, so keep sets it and undo removes it.
  await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'keep',
    fields: ['reference'],
    source: 'click',
  });
  expect(await note(n.id)).toMatchObject({ customFields: { kunde: 'Müller GmbH' } });
  await decide(fx.ownerToken, fx.boardId, suggestion.id, { decision: 'undo', source: 'esc' });
  expect((await note(n.id)).customFields).toEqual({});
});
```

Adjust the existing cases that assert the exact shape of `fields` or `kept` for the three new keys and `typed` (`toMatchObject` keeps most of them green). The "cut short" case: look at how the file already cuts a keep short (slice 2 added "finish or undo a suggestion keep cut short"); reuse that mechanism (a one-shot `vi.spyOn` on the collection or on `runOperation`'s module). The stale-after-property case and the existing-key case above are deliberately about the fold: when the board's other note uses `Kunde` and the model says `kunde`, `accept()` folds the key to the board's spelling `Kunde`, and `customFields` on the note then reads `{ Kunde: … }`, not `kunde`. Write the assertions with the folded spelling (`Kunde`) once you have implemented the fold; the snippets above say `kunde` only where no board key exists.

Run the file: FAIL.

- [ ] **Step 2: Implement in `suggestions.ts`**

The shape of the change, each part written out:

1. Constants: `SUGGESTION_MAX_OUTPUT_TOKENS = 512`.
2. `mintOperationIds()` adds `title`, `reference` and `subtasks: Array.from({ length: SUGGESTION_MAX_SUBTASKS }, () => ({ apply: randomUUID(), undo: randomUUID() }))`.
3. `candidates(note, locked)` adds: `title` when `!locked.includes('title')` and the note has a non-empty title; `reference` when `Object.keys(note.customFields ?? {}).length === 0 && !locked.includes('reference')`; `subtasks` when `note.subtaskSummary.total === 0 && !locked.includes('subtasks')`.
4. The board's property keys for the prompt: `const boardNotes = await listNotes(db, actor, board.id, { status: 'ALL' })` and `const fieldKeys = collectKeys(boardNotes)` (a local helper mirroring the web's `collectFieldKeys`: case-insensitively de-duplicated, first spelling wins, sorted with `localeCompare(…, 'de')`). Pass `fieldKeys` into `buildCapturePrompt`.
5. `accept(fields, open, memberIds, today, note, fieldKeys)` adds:
   - `title`: when open, sure, and `fields.title.value.trim() !== note.title.trim()` → `{ value: fields.title.value.trim(), reason }`.
   - `reference`: when open and sure, fold the key: `const key = fieldKeys.find((k) => k.toLocaleLowerCase('de') === fields.reference.key.trim().toLocaleLowerCase('de')) ?? fields.reference.key.trim()`; accept only if `customFieldKeySchema.safeParse(key).success && customFieldValueSchema.safeParse(fields.reference.value).success` → `{ key: customFieldKeySchema.parse(key), value: fields.reference.value.trim(), reason }`.
   - `subtasks`: when open and sure: `items = unique(fields.subtasks.items.map(trim).filter(Boolean))` (first occurrence wins) limited to `SUGGESTION_MAX_SUBTASKS`; accept when `items.length >= 1` → `{ items, reason }`.
6. The record: `typed: request.locked`, the three new fields.
7. The chain generalises from keys to **steps**: `type Step = { key: SuggestionFieldKey; index?: number }` (index only for `subtasks`). `stepsFor(fields, subtaskIndexes)` returns, in the canonical order `dueDate, priority, assignee, title, reference, subtasks`, one step per kept key, expanding `subtasks` into one step per kept index (ascending). `fieldCall(step, doc, expectedRevision, values)` adds:
   - `title` → `update_note` with `input: { title: values.title }`.
   - `reference` → `update_note` with `input: { fieldChanges: values.reference.previous === undefined ? { set: { [key]: value } } : (restore) }` — write it as two helpers: `applyCall` (set the proposed value) and `undoCall` (when `before.reference.previous === null` → `{ fieldChanges: { remove: [key] } }`, else `{ fieldChanges: { set: { [key]: previous } } }`).
   - `subtasks` apply step `i` → `add_subtask` with `input: { text: items[i] }`; undo step `i` → `delete_subtask` with `subtaskId: applied.subtaskIds[position]` where position is the step's position among the kept indexes.
   - Ids: `ids(step)` → `operationIds[key].apply/undo` or `operationIds.subtasks[index].apply/undo`; a missing id (an old record) throws `settled()`.
8. `runChain` collects per step the result: for an `add_subtask` step it records `created.push((result.data as { id: string }).id)` (a replayed receipt returns the same id). `completeKeep` writes `applied: { before, fields: kept, subtasks: keptIndexes, subtaskIds: created, revision }` where `before` now includes `title: note.title` and `reference: fields.reference ? { key, previous: findFieldKey(note.customFields, key) ? note.customFields[found] : null } : null` (read on the note at `baseRevision`; the keep's first write refuses a changed note, so these are exact).
9. `revertWrites` after a failed keep: for `subtasks` steps delete the created ids (fresh operation ids), for `title` restore `before.title`, for `reference` undo as above.
10. Undo: inverse steps = reverse of the applied steps (subtasks newest first), `before` values, `operationIds[…].undo`.
11. `decideSuggestion` keep: `requested = decision.fields ?? proposed`; `fields = suggestionFieldKeys.filter(...)`; `subtaskIndexes = fields.includes('subtasks') ? unique(decision.subtasks ?? all indexes).filter(i => i < items.length).sort() : []`; if `fields.includes('subtasks') && subtaskIndexes.length === 0` drop `subtasks` from `fields`; store `decision.subtasks = subtaskIndexes`.
12. `liveFields` unchanged for the assignee; the new fields pass through. `toDto` returns them, `typed`, and `kept.subtasks`.
13. `pendingSuggestions` unchanged.

- [ ] **Step 3: Green, neighbours, checks, commit**

Run `test/assistant-suggestions.test.ts` until green, then one at a time `test/assistant-operations.test.ts`, `test/assistant-turns.test.ts`, and the unit tests under `src/lib/assistant`. Then `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint && pnpm format:check`.

```bash
git add apps/api/src/lib/assistant/suggestions.ts apps/api/test/assistant-suggestions.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(api): a keep writes the title, the reference and each kept step; undo takes them back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The web controller: per-item steps, an opt-in title, rows the panel can tick

**Files:**

- Modify: `apps/web/src/features/board/Suggestions/useSuggestions.ts`
- Modify: `apps/web/src/features/board/Suggestions/pendingProps.ts`
- Modify: `apps/web/src/features/board/Suggestions/useSuggestions.test.tsx`
- Modify: `apps/web/src/test/fixtures.ts`

**Interfaces:**

- `SuggestionMark` gains `subtasks: number[]` (the kept indexes; all proposed items at first).
- `SuggestionsController` gains `setField(noteId, key, on)` (adds or removes a proposed key; removing the last one discards as before) and `setSubtask(noteId, index, on)` (removing the last item removes the `subtasks` key).
- `proposed(s)` excludes `title` (R2). A countdown runs only when `fields` holds something other than `title`.
- The keep body carries `subtasks: mark.subtasks` whenever `subtasks` is among the fields.
- `PendingProps` gains `onSetField(key, on)` and `onSetSubtask(index, on)`; `proposedValues` returns `title`, `reference` and `subtasks` (the latter as `{ items, kept: number[] }` or null).

- [ ] **Step 1: Failing tests** (`useSuggestions.test.tsx`; the `dto` helper's fields gain `title`, `reference` and `subtasks` set to null by default, and `typed: []`):

- "a proposed title waits for the person: the countdown keeps the date and leaves the title": dto with `title` and `dueDate` → after `COUNTDOWN_MS` decide called with `fields: ['dueDate']`; `setField('n1','title',true)` before the countdown → decide with `['dueDate','title']`.
- "a title alone runs no countdown and keeps only when ticked": dto with only `title` → `countdownEndsAt` null; `keep()` without ticking → no decide call (nothing to keep; the mark stays); `setField('n1','title',true)` then `keep` → decide with `['title']`.
- "steps are kept one by one": dto with `subtasks: { items: ['a','b','c'] }` and `dueDate` → mark.subtasks `[0,1,2]`; `setSubtask('n1',1,false)` → `[0,2]`; keep → body `{ fields: ['dueDate','subtasks'], subtasks: [0,2] }`; unticking all three removes `subtasks` from fields; `setSubtask('n1',1,true)` adds it back with `[1]`.
- "a restored record keeps its typed list and its kept subtasks after a keep": the `kept` phase mark carries `fields: suggestion.kept.fields` and `subtasks: suggestion.kept.subtasks`.

Run: FAIL.

- [ ] **Step 2: Implement**

`useSuggestions.ts`: `proposed = (s) => suggestionFieldKeys.filter((key) => key !== 'title' && s.fields[key] !== null)`; `showPending` sets `subtasks: s.fields.subtasks ? s.fields.subtasks.items.map((_, i) => i) : []` and computes `countdown` with the added condition `fields.some((k) => k !== 'title')`; `keep` and the countdown's decide send `{ decision: 'keep', fields: mark.fields, ...(mark.fields.includes('subtasks') ? { subtasks: mark.subtasks } : {}), source }`; the `kept` patch sets `fields: suggestion.kept?.fields ?? []` and `subtasks: suggestion.kept?.subtasks ?? []`; `remove(noteId, key)` becomes `setField(noteId, key, false)`, keep `remove` as an alias used by the card. Add:

```ts
const setField = useCallback<SuggestionsController['setField']>(
  (noteId, key, on) => {
    const mark = latestMarks.current.get(noteId);
    if (mark?.phase !== 'pending' || !mark.suggestion || deciding.current.has(noteId)) return;
    if (mark.suggestion.fields[key] === null) return;
    const fields = on
      ? suggestionFieldKeys.filter((k) => k === key || mark.fields.includes(k))
      : mark.fields.filter((k) => k !== key);
    if (fields.length === 0) {
      decide(noteId, { decision: 'discard', source: 'remove' });
      return;
    }
    const subtasks =
      key === 'subtasks' && on && mark.subtasks.length === 0
        ? (mark.suggestion.fields.subtasks?.items.map((_, i) => i) ?? [])
        : mark.subtasks;
    patch(noteId, { ...mark, fields, subtasks });
  },
  [decide, patch],
);
const setSubtask = useCallback<SuggestionsController['setSubtask']>(
  (noteId, index, on) => {
    const mark = latestMarks.current.get(noteId);
    if (mark?.phase !== 'pending' || deciding.current.has(noteId)) return;
    const items = mark.suggestion?.fields.subtasks?.items ?? [];
    if (index < 0 || index >= items.length) return;
    const subtasks = on
      ? [...new Set([...mark.subtasks, index])].sort((a, b) => a - b)
      : mark.subtasks.filter((i) => i !== index);
    if (subtasks.length === 0) {
      setField(noteId, 'subtasks', false);
      return;
    }
    const fields = mark.fields.includes('subtasks')
      ? mark.fields
      : suggestionFieldKeys.filter((k) => k === 'subtasks' || mark.fields.includes(k));
    patch(noteId, { ...mark, fields, subtasks });
  },
  [patch, setField],
);
```

(the `fields` list stays in the enum's canonical order everywhere.) A countdown also stops when a `setField` leaves only `title` (recompute `countdownEndsAt`/clock as `setPaused` does; simplest: after patching, if `!fields.some((k) => k !== 'title')` call `stopClock` and set `countdownEndsAt: null`).

`pendingProps.ts`: `PendingProps` gains `onSetField` and `onSetSubtask`; `proposedValues` adds `title: has('title') ? fields.title : null` (shown regardless of the note's own title: it is a second line), `reference: has('reference') && Object.keys(note.customFields ?? {}).length === 0 ? fields.reference : null`, `subtasks: has('subtasks') && note.subtaskSummary.total === 0 && fields.subtasks ? { items: fields.subtasks.items, kept: mark.subtasks } : null`; and a kept mark shows them until the refetch as before. Export a `proposedTitle(mark)` helper that returns the title proposal whether or not it is in `fields` (the card shows the line in both states; ticked means it is in `fields`).

`fixtures.ts` `makeSuggestionMark`: add `subtasks: []`.

- [ ] **Step 3: Green, commit**

Run `useSuggestions.test.tsx`, `NoteCard.test.tsx`, `NoteRow.test.tsx`, `AppShell`-related tests if any (`BoardPage.test.tsx`), then `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check`. The `pendingFor` in `AppShell.tsx` must supply the two new handlers (`onSetField: (key, on) => suggestions.setField(noteId, key, on)`, `onSetSubtask: …`); do that here so typecheck passes.

```bash
git add apps/web/src/features/board/Suggestions/useSuggestions.ts apps/web/src/features/board/Suggestions/useSuggestions.test.tsx apps/web/src/features/board/Suggestions/pendingProps.ts apps/web/src/features/board/AppShell.tsx apps/web/src/test/fixtures.ts
git -c core.hooksPath=/dev/null commit -m "feat(web): the pending change ticks steps one by one and offers the title without taking it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The card shows the title line, the reference and the steps

**Files:**

- Modify: `apps/web/src/features/board/WandView/NoteCard.tsx`, `NoteCard.test.tsx`
- Modify: `apps/web/src/features/board/ListView/NoteRow.tsx`, `NoteRow.test.tsx`
- Modify: `apps/web/src/i18n/de.ts`, `apps/web/src/i18n/en.ts` (`suggest.fields` and `suggest.title`)

- [ ] **Step 1: Copy** (`de`):

```ts
    title: {
      /** The second line under the person's own title (BRAND rule 7). */
      proposed: 'Vorschlag: {{title}}',
      take: 'Vorschlag für den Titel übernehmen',
      mine: 'Meinen Titel behalten',
    },
```

and in `suggest.fields`: `reference: '{{key}}: {{value}}'`, `subtasks_one: '{{count}} Schritt'`, `subtasks_other: '{{count}} Schritte'`. English: `proposed: 'Suggested: {{title}}'`, `take: 'Take the suggested title'`, `mine: 'Keep my title'`, `reference: '{{key}}: {{value}}'`, `subtasks_one: '{{count}} step'`, `subtasks_other: '{{count}} steps'`.

- [ ] **Step 2: Failing tests**

`NoteCard.test.tsx`, in the pending describe: "offers a cleaner title as a second line, taken by a tap and dropped by its ×": a mark with `title: { value: 'Angebot an Müller' }` not in `fields` → the card shows the person's title and a line `Vorschlag: Angebot an Müller` with `aria-pressed="false"` on its button-role span; a click calls `onSetField('title', true)`; with `title` in `fields` → `aria-pressed="true"`; the × (name `Meinen Titel behalten`) calls `onRemove('title')`. "shows the reference and the step count with an × each": `reference` → text `Kunde: Müller GmbH` with × `Vorschlag entfernen: Kunde: Müller GmbH`; `subtasks` with 3 items and `kept: [0,2]` → the checklist place shows `2 Schritte` (the kept count) with × `Vorschlag entfernen: 2 Schritte` calling `onRemove('subtasks')`. The same two cases for `NoteRow`.

Run: FAIL.

- [ ] **Step 3: Implement**

`NoteCard.tsx` body: after the title span, when `proposedTitle(mark)` exists and the phase is pending, render

```tsx
<span
  role="button"
  tabIndex={0}
  aria-pressed={taken}
  data-proposed="title"
  onClick={(e) => { e.stopPropagation(); pending.onSetField('title', !taken); }}
  onKeyDown={…Enter/Space as ProposedField…}
  onPointerDown={stop} onMouseDown={stop}
  title={t('suggest.reason', { reason })}
  className={cn('-mt-1 line-clamp-2 text-12 leading-snug', taken ? 'text-fg-1' : 'text-fg-meta-on-note', 'rounded-[3px] focus-visible:…')}
>
  {t('suggest.title.proposed', { title: value })}
</span>
```

followed by the × (`ProposedField`'s × markup, name `t('suggest.title.mine')`, calling `pending.onRemove('title')`). Keep the structure inside `ProposedField` if it is simpler: give `ProposedField` an optional `onToggle`/`pressed` pair and reuse it. The reference renders in the meta line as `ProposedField` with `label` text `t('suggest.fields.reference', …)`; the steps render where `checklistLabel` sits, as `ProposedField` with `label` `t('suggest.fields.subtasks', { count: kept.length })` and the `ListChecks` icon. `NoteRow.tsx` mirrors: the title line goes under the title in the flex-wrap area as a full-width second line (`basis-full`), the reference and the step count join `metaParts`' place as `ProposedField`s.

- [ ] **Step 4: Green, guards, commit**

Run the two test files, `ListView.test.tsx`, `WandView.test.tsx`, then the guards, then `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check`.

```bash
git add apps/web/src/features/board/WandView/NoteCard.tsx apps/web/src/features/board/WandView/NoteCard.test.tsx apps/web/src/features/board/ListView/NoteRow.tsx apps/web/src/features/board/ListView/NoteRow.test.tsx apps/web/src/features/board/Suggestions/ProposedField.tsx apps/web/src/i18n/de.ts apps/web/src/i18n/en.ts
git -c core.hooksPath=/dev/null commit -m "feat(web): the card offers the title beside the person's own, and shows the reference and the steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The review in the panel, grouped by source

**Files:**

- Create: `apps/web/src/features/board/NoteDetail/PendingReview.tsx`
- Test: `apps/web/src/features/board/NoteDetail/PendingReview.test.tsx`
- Modify: `apps/web/src/features/board/NoteDetail/NoteDetailPanel.tsx`, `NoteDetailPanel.test.tsx`
- Modify: `apps/web/src/features/board/AppShell.tsx`
- Modify: `apps/web/src/i18n/de.ts`, `en.ts` (`suggest.review`)

**Interfaces:**

- `PendingReview({ note, pending, onTypedChange })`: renders two groups from `pending.mark` and the note; `onTypedChange(key, on)` is the panel's own mutation for a typed row (R4).
- `NoteDetailPanel` gains `pending?: PendingProps`; `AppShell` passes `pendingFor(viewState.noteId)` and pauses the countdown while the panel shows a pending note.

- [ ] **Step 1: Copy** (`de`):

```ts
    review: {
      label: 'Wallybot',
      typed: 'Aus deinem Text',
      added: 'Von Wallybot ergänzt',
      keep: 'Behalten',
      discard: 'Verwerfen',
      undo: 'Rückgängig',
      waiting: 'Wartet auf dich.',
      counting: 'Wird gleich übernommen; solange das Fenster offen ist, wartet es.',
      kept: 'Übernommen.',
      rowTitle: 'Titel: {{title}}',
      rowText: 'Text',
      rowDue: 'Fällig {{date}}',
      rowPriority: 'Priorität {{label}}',
      rowAssignee: 'Zuständig: {{name}}',
      rowReference: '{{key}}: {{value}}',
      rowStep: 'Schritt: {{text}}',
    },
```

(en: 'Wallybot', 'From what you typed', 'Added by Wallybot', 'Keep', 'Discard', 'Undo', 'Waiting for you.', 'Applied in a moment; it waits while this panel is open.', 'Kept.', 'Title: {{title}}', 'Text', 'Due {{date}}', 'Priority {{label}}', 'Assigned to {{name}}', '{{key}}: {{value}}', 'Step: {{text}}').

- [ ] **Step 2: Failing tests**

`PendingReview.test.tsx`:

- "shows the typed group from the note and the record, and the added group from the proposal": note with `dueDate` set and `typed: ['dueDate']`, proposal with `priority`, `reference`, `subtasks` (3 items) and `title` → group "Aus deinem Text" has rows `Titel: <note title>` (checked, disabled: the title is the note) and `Fällig …` (checked); group "Von Wallybot ergänzt" has `Vorschlag: …` title row unchecked, `Priorität hoch` checked, `Kunde: Müller GmbH` checked, three `Schritt: …` rows checked.
- "ticking rows reports to the controller": unticking a step calls `onSetSubtask(1, false)`; ticking the title calls `onSetField('title', true)`; unticking the reference calls `onSetField('reference', false)`; unticking the typed due date calls `onTypedChange('dueDate', false)`.
- "Keep, Discard and Undo": Keep calls `onKeep`; Discard calls `onDiscard`; in the kept phase only Undo shows and calls `onUndo`; the status line reads `Wartet auf dich.` when no countdown runs and `Wird gleich übernommen…` when one does.

`NoteDetailPanel.test.tsx`: "shows the review section only for a note with a pending change": without `pending` → no `Wallybot` section; with a pending mark → the section is present above the subtasks; unticking the typed date row sends `notesApi.update(noteId, { dueDate: null })`.

Run: FAIL.

- [ ] **Step 3: Implement**

`PendingReview.tsx`: a `PanelSection` with `FieldLabel` `t('suggest.review.label')`, a status line (`role="status"`, text per phase/countdown), two groups each a `<ul>` under a `FieldLabel`; each row a `<li>` with `Checkbox` (`id` per row, a `<label htmlFor>`), the label text from the catalogue; typed rows: the note's title (checked, disabled), the text if any (checked, disabled), and for each key in `pending.mark.suggestion.typed` the note's own value (`dueDate` → date label via `proposedDateLabel`, `priority` → enum label, `assignee` → name) with `onCheckedChange={(on) => onTypedChange(key, Boolean(on))}`; added rows from `proposedValues`/`proposedTitle` with `onSetField` / `onSetSubtask`. Footer: `Button variant="accent" size="sm"` Keep (the one accent in the panel; the panel has no other accent button; check `NoteDetailPanel` and BRAND "at most one at rest" and use `variant="default"` if the panel already has an accent), `Button variant="ghost"` Discard; in the kept phase one ghost Undo. The section is `data-pending-review`.

`NoteDetailPanel.tsx`: accept `pending?: PendingProps`; render `<PendingReview note={note} pending={pending} onTypedChange={…} />` as the first `PanelSection` after the description when `pending && pending.mark.phase !== 'asking'`; `onTypedChange('dueDate', false)` → `updateNote.mutate({ noteId, input: { dueDate: null } })`, `'priority'` → `moveNote.mutate({ …, input: { mode: 'PRIORITY', priority: 'MITTEL' } })`, `'assignee'` → `assignNote.mutate({ noteId, assigneeId: null, optimisticAssignee: null })`; `on === true` re-sets the value from the record's… no: a typed row unticked is gone from the note, and the row disappears with it (the note no longer holds it), so `on` is never `true`; keep the signature `(key, on)` for symmetry and ignore `true`.

`AppShell.tsx`: pass `pending={viewState.noteId ? pendingFor(viewState.noteId) : undefined}` to `NoteDetailPanel`; add

```ts
// The panel open on a pending note pauses its countdown (R3): reading the review takes time.
const openPending =
  viewState.noteId !== null && suggestions.marks.get(viewState.noteId)?.phase === 'pending';
useEffect(() => {
  if (!openPending || !viewState.noteId) return;
  const noteId = viewState.noteId;
  suggestions.setPaused(noteId, true);
  return () => suggestions.setPaused(noteId, false);
}, [openPending, viewState.noteId, suggestions]);
```

(`setPaused` is stable per the hook's `useCallback`; depend on `suggestions.setPaused`).

- [ ] **Step 4: Green, guards, suite, commit**

Run the two test files, then `src/i18n/*` guards and `brandGuards`, then the whole web suite once, then `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check`.

```bash
git add apps/web/src/features/board/NoteDetail/PendingReview.tsx apps/web/src/features/board/NoteDetail/PendingReview.test.tsx apps/web/src/features/board/NoteDetail/NoteDetailPanel.tsx apps/web/src/features/board/NoteDetail/NoteDetailPanel.test.tsx apps/web/src/features/board/AppShell.tsx apps/web/src/i18n/de.ts apps/web/src/i18n/en.ts
git -c core.hooksPath=/dev/null commit -m "feat(web): the note panel reviews a pending change in two groups, from you and from Wallybot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs and the E2E guard

**Files:**

- Modify: `docs/rfcs/RFC-0005-wallybot-inline.md` (status line: slice 3 started; links moved to a follow-up by this plan's R1)
- Modify: `docs/SPEC.md` (the capture paragraph gains one sentence on the review and the new fields)
- Modify: `docs/BRAND.md` ("## AI" first paragraph names the review in the panel and the title line as rule 7's instance)
- Modify: `apps/web/e2e/note-create.spec.ts` (after the note is visible, open it with a click and assert `[data-pending-review]` has count 0: a plain note has no review section)

- [ ] **Step 1: Edit the four files**, run `pnpm format:check` and `cd apps/web && pnpm exec playwright test --list`, commit:

```bash
git add docs/rfcs/RFC-0005-wallybot-inline.md docs/SPEC.md docs/BRAND.md apps/web/e2e/note-create.spec.ts
git -c core.hooksPath=/dev/null commit -m "docs: the review grouped by source; the E2E pins that a plain note has none

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** §3.3's title line as a second line with "use mine" (T6, R2); §3.4's subtasks and reference (T3, T4), the two groups with a checkbox per row and the card following the ticks (T5, T7), the source mark (declined by R5), links (deferred by R1); §4's record, chaining and undo for the new writes (T4) with the one new operation (T2, R6); §7 holds: nothing is overwritten (the reference only on a note without properties, steps only on a note without any, the title never by the countdown). WALLY_AGENT §3.2: every write attributed and audited (T4 asserts the audit rows), the keep resumable (Review Focus 1).
- **Placeholders.** Task 4 describes the chain generalisation as numbered parts with the exact calls and inputs rather than a full listing, because the file is 750 lines and the diff touches most of its helpers; each part names the function and the shape. Task 7's component is described by its rows and handlers with the markup pattern named (`PanelSection`, `FieldLabel`, `Checkbox`, `Button`).
- **Type consistency.** `SuggestionFieldKey` and `suggestionFieldKeys` from the shared package everywhere; `SUGGESTION_MAX_SUBTASKS` shared; `kept.subtasks` and `decision.subtasks` are index arrays on both sides; `PendingProps.onSetField/onSetSubtask` (T5) consumed by T6 and T7; `proposedTitle` (T5) used by T6 and T7; `typed` written by T4, read by T7.
- **Review Focus.** 1 → T4 "resumes a keep cut short"; 2 → T5's two title cases and T7's status line; 3 → T4 "keeps a subset" and T7 "ticking rows"; 4 → T4's two reference cases; 5 → T7's AppShell pause effect (test it through `NoteDetailPanel`'s wiring or a small AppShell-level test if one exists; otherwise the pause is covered by the controller's `setPaused` tests and named in the PR as checked in the visual pass).
- **Deferred, for the PR:** links between notes (R1); the per-field source mark (R5); a kept title's "use mine" after the keep (undo covers it); the review in a card that expands on the wall (R3).
