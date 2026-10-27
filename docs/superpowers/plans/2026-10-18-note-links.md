# Links Between Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A note can be related to other notes on its board: Wallybot proposes links to related notes after Enter (slice 3's deferred half of 0005-wallybot-inline.md §3.4), the person keeps them one by one or adds and removes them in the note panel, the panel lists what a note is related to in both directions, and on the free canvas a hairline joins related cards, dashed while a proposal is pending and solid once kept.

**Architecture:** One new stored field, `links: string[]` on the note (one direction, at most ten), written through `note.update` with a `linkChanges { add, remove }` set applied to the note's current list inside the command transaction, which checks every target (same board, alive, visible to the caller, not the note itself); no new operation, so WALLY_AGENT §3.3 is unchanged. The suggestion record grows a `links` field with per-item ticks exactly as `subtasks` has, kept by one `update_note` write and undone by its inverse. On the web the controller, the card and the review learn the field in the same places `subtasks` taught them; the panel gets a "Related" section with a picker; the free canvas gets an SVG layer under the cards.

**Tech Stack:** Fastify + Zod + firebase-admin; Vercel AI SDK behind `apps/api/src/lib/assistant/model/`; React 19 + TanStack Query 5 + Radix Popover + cmdk (both already in the app). No new dependency.

**Spec:** `docs/rfcs/0005-wallybot-inline.md` §3.4 (links, the hairline), §4, §7; `docs/rfcs/0003-wally-agent.md` §3.2 and §3.3 (`update_note` covers the write); `docs/BRAND.md` "## AI" rules 3–7, "Shape, depth and motion". Slice 3's plan `docs/superpowers/plans/2026-10-17-capture-review.md` (its R1 deferred this; its subtasks pattern is what links copy) is the record of the code this builds on.

## Context

**Handoff/review amendments (2026-10-18):** L7's raw DTO rule is superseded: list, detail,
and mutation/replay responses filter links per caller to live, same-board targets. Link edits
reclaim missing/deleted targets before the ten-link cap; live private relations remain stored.
Every requested addition is validated, including an already stored target. No background cleanup.
Proposed-link consumers use the stored `item.index`, not the filtered array position.

Slice 3 deferred links because they need a stored relation, the model reading the board, and lines across the wall's scroll containers (R1 there). Decisions for this plan, each with its reason and its cost if wrong:

- **L1. The relation is a list of note ids on the note that links**, `links: string[]`, at most `MAX_LINKS_PER_NOTE = 10`, one direction stored. Both sides show it: a note's panel lists the notes it links to and the notes that link to it (derived from the board's notes the client already holds). No separate collection: a link is a property of the note that was written, like a tag. Cost if wrong: a migration to an edge collection later.
- **L2. `note.update` carries `linkChanges { add?: id[], remove?: id[] }`**, applied to the note's current list on the server (as `fieldChanges` and `tagChanges` are), so two people linking at once both keep theirs. Inside the transaction each added id is read: it must be a live note of the same board the caller can see, and not the note itself; otherwise 422 `LINK_TARGET_INVALID`. Removing an id that is not there is a no-op. The target note is not written: its revision does not move. Cost if wrong: a looser rule.
- **L3. Wallybot proposes one to three links**, a `links` field on the suggestion with per-item ticks like steps: `{ items: [{ noteId, reason }], reason }`, offered only on a note with no links yet, when the board has other open notes the person can see. The prompt gets those notes as data, `id: title`, newest first, at most 40. A reply's link is accepted when its id is among the rows, not the note itself, confident, each once, at most three. The DTO resolves each item's title at read time from the board's notes; an item whose note is gone drops out. Cost if wrong: a cap and a prompt line.
- **L4. One write keeps every ticked link**: `update_note { linkChanges: { add: ids } }` under the field's apply id; undo is `{ remove: ids }` under the undo id. The note had no links at `baseRevision` (L3), so undo removes exactly what the keep added; `stillWritten` checks the ids are still on the note. The undo runs on the kept revision like every other field (0005-wallybot-inline.md §4), so a link added or removed by hand after the keep refuses it with 409 `STALE_REVISION` and every link stays, as a step deleted by hand does (amended after the Task 4 review: the first draft expected the undo to succeed around a hand link, which §4 does not allow). `decision.links` names the ticked items by index, as `subtasks` does. Cost if wrong: nothing to migrate; records written before this have no `links` and read as proposing none.
- **L5. Hairlines on the free canvas only.** An SVG layer under the cards draws a 1 px line in the note border colour between the centres of related cards (card centres from `freeX`/`freeY` and the card constants, so the lines follow a drop as the data does): dashed for a proposed link still ticked while the proposal is pending, solid for a kept link; each pair once. Zone bands and the list draw no lines (nested scroll containers, the risk slice 3 named); there the relation is read in the panel, and the card's meta row shows the count of related notes beside the subtask count. Cost if wrong: a layer to extend.
- **L6. The panel's "Related" section** lists the related notes as rows (priority icon, title, due date, as the answer card's rows do), with an × on the note's own links; a note that links here is listed read-only with its direction said in the row's tooltip. "Link a note…" opens a searchable list of the board's other notes (the palette's components in a popover); picking one adds it. A viewer on a note they may not edit sees the rows and no controls. Cost if wrong: a picker to restyle.
- **L7. A deleted or private-made note leaves a dangling id** on the notes that linked it; readers drop ids they cannot resolve (the web filters against the board's notes; the DTO's `links` is the raw list). No cleanup on delete in this slice. Cost if wrong: a maintenance pass later.
- **L8. The parser proposes no links**: links need the board, not the words; they are Wallybot's alone (§3.4 "the AI adds what the parser could not").
- **L9. Persisted values stay as they are** (ADR-0014's rename is a separate release); every new identifier is English.

## Global Constraints

- Work only in `/Users/mr_user/development/apps/wally-links`, branch `feat/note-links` (cut from `origin/main` after PR #51; base `main`; never stacked). Never run git or edit files in `/Users/mr_user/development/apps/wally` (bind-mounted into the running stack) or in any other worktree under `/Users/mr_user/development/apps/` (`wally-questions` and `wally-tidy` hold other slices).
- API route tests need the Firestore emulator on `localhost:8080` and run ONE FILE AT A TIME: `cd /Users/mr_user/development/apps/wally-links/apps/api && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=wally-local CORS_ORIGIN=http://localhost:5173 pnpm vitest run test/<file>`. Never two emulator runs at once, never the whole API suite in one command, never any docker command. Unit tests under `apps/api/src` need no emulator.
- Web tests touch no emulator: `cd /Users/mr_user/development/apps/wally-links/apps/web && pnpm vitest run <file>`, one file at a time while iterating; the whole web suite once per task before committing.
- Checks from the worktree root: `pnpm --filter @wally/shared build` (after any shared change), `pnpm --filter @wally/api typecheck`, `pnpm --filter @wally/api lint`, `pnpm --filter @wally/web typecheck`, `pnpm --filter @wally/web lint`, `pnpm format:check` (fix with `pnpm format`). Guard tests stay green: `apps/api/src/lib/assistant/model/boundary.test.ts`, `apps/web/src/brandGuards.test.ts`, `apps/web/src/englishIdentifiers.test.ts`, `src/i18n/noHardcodedCopy.test.ts`, `src/i18n/resources.test.ts`, `src/i18n/germanSurface.test.tsx`, `src/features/board/WallView/NoteCard.test.tsx`.
- No new dependency. The model library only under `apps/api/src/lib/assistant/model/`. Copy only from the catalogues (`de.ts` authority, `en.ts` mirror); German words in TS source outside the catalogues as `\u` escapes where the guard requires.
- BRAND.md: marigold only as the dot and its ring; the dashed edge is the note's border colour; proposed values in the note's own type and colour; the hairline is `var(--note-border)`, 1 px, never a colour; no toasts, no modals, no badges, no name, no first person; controls at least 40 px on a coarse pointer; motion 120–180 ms on transform and opacity only.
- Every write a keep or an undo makes goes through `runOperation` with the record's provenance and leaves an audit row; every model call reserves before and settles after.
- Conventional Commits; never commit to `main`. Commit with `git -c core.hooksPath=/dev/null commit`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the model that wrote them, as the workflow names it).
- Prettier: single quotes, trailing commas, width 100.

## Review Focus

1. A `linkChanges.add` naming the note itself, a note on another board, a deleted note, or another person's private note is refused with 422 and writes nothing; a valid add appears in the DTO and leaves the target's revision alone. Tests in Task 1.
2. A keep with two of three proposed links ticked writes exactly those two ids in one `update_note`, once (a replay adds nothing); undo removes exactly them; a link the person added by hand in between moves the revision, so the undo is refused with 409 `STALE_REVISION` (§4: the kept revision is the undo's `expectedRevision`) and every link stays, the hand link included. Tests in Task 4.
3. The model names a note that is not on the board, the note itself, or one twice: none of those is proposed; a renamed target reads with its current title; a deleted target drops out of the proposal. Tests in Tasks 3 and 2.
4. The panel lists a backlink read-only and an own link with an ×; the picker never offers the note itself, an already linked note, or a note the person cannot see. Tests in Task 6.
5. On the free canvas a pending proposal draws a dashed hairline per ticked link and none for an unticked one; after the keep the line is solid; in zone mode and the list no line is drawn; the card's count says how many notes are related. Tests in Tasks 5 and 7.

---

### Task 1: The relation: `links` on the note, `linkChanges` on the update

**Files:**

- Modify: `packages/shared/src/constants.ts`, `packages/shared/src/schemas/note.ts`
- Modify: `apps/api/src/lib/db/types.ts`, `apps/api/src/lib/dto.ts`, `apps/api/src/lib/notes.ts`, `apps/api/src/lib/commands/notes.ts`
- Create: `apps/api/test/notes-links.test.ts`
- Modify: `apps/web/src/test/fixtures.ts` (`makeNote` gains `links: []`)

**Interfaces:**

- Produces (shared): `MAX_LINKS_PER_NOTE = 10`; `noteUpdateSchema.linkChanges?: { add?: string[]; remove?: string[] }`; `noteDtoSchema.links: string[]`.
- Produces (API): `NoteDoc.links?: string[]`; `applyLinkChanges(current: string[], changes, noteId): string[]` (pure); the transaction check in `executeNoteCommand`; error code `LINK_TARGET_INVALID`.

- [ ] **Step 1: Shared**

`packages/shared/src/constants.ts`, after `MAX_FIELDS_PER_NOTE`:

```ts
/** Related notes one note may link to (0005-wallybot-inline.md §3.4; the plan's L1). */
export const MAX_LINKS_PER_NOTE = 10;
```

`packages/shared/src/schemas/note.ts`: import `MAX_LINKS_PER_NOTE`; define before `noteUpdateSchema`:

```ts
/** A note id as the API writes them. */
const linkIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'Invalid note id');
```

add to `noteUpdateSchema`'s object, after `tagChanges`:

```ts
    /**
     * Related notes, added to / removed from the note's current list (the plan's L2). Each
     * added id must be a live note of the same board the caller can see, and not the note
     * itself; the server refuses the whole update otherwise.
     */
    linkChanges: z
      .object({
        add: z.array(linkIdSchema).max(MAX_LINKS_PER_NOTE).optional(),
        remove: z.array(linkIdSchema).max(MAX_LINKS_PER_NOTE).optional(),
      })
      .optional(),
```

and to `noteDtoSchema`, after `tags`:

```ts
  /** Ids of the notes this one links to (L1); a reader drops an id it cannot resolve (L7). */
  links: z.array(z.string()),
```

Build the shared package.

- [ ] **Step 2: Stored shape, DTO, the pure change**

`apps/api/src/lib/db/types.ts` `NoteDoc`: after `tags`, `/** Related notes, by id; missing on notes written before links existed. */ links?: string[];`.

`apps/api/src/lib/dto.ts` `toNoteDto`: after `tags: note.tags,` add `links: note.links ?? [],`.

`apps/api/src/lib/notes.ts`, after `applyTagChanges`:

```ts
/**
 * The same for `linkChanges`: removals, then additions not already present, in order, never
 * the note itself. Whether an added id is a live, visible note of the board is checked in the
 * command's transaction, where the notes can be read.
 */
export function applyLinkChanges(
  current: string[],
  changes: NonNullable<NoteUpdateInput['linkChanges']>,
  noteId: string,
): string[] {
  const removed = new Set(changes.remove ?? []);
  const next = current.filter((id) => !removed.has(id));
  for (const id of changes.add ?? []) {
    if (id === noteId)
      throw new AppError(422, 'LINK_TARGET_INVALID', 'A note cannot link to itself');
    if (!next.includes(id)) next.push(id);
  }
  if (next.length > MAX_LINKS_PER_NOTE)
    throw new AppError(
      400,
      'BAD_REQUEST',
      `A note may link to at most ${MAX_LINKS_PER_NOTE} notes`,
    );
  return next;
}
```

(import `MAX_LINKS_PER_NOTE` from `@wally/shared`.)

`apps/api/src/lib/commands/notes.ts`, in `case 'note.update'`: destructure `linkChanges` beside `fieldChanges` and `tagChanges`; before `changes = {…}` add

```ts
let links: string[] | undefined;
if (linkChanges) {
  links = applyLinkChanges(note.links ?? [], linkChanges, note.id);
  // Every new target is read inside the transaction: a live note of this board the
  // caller can see (the plan's L2). A target that fails is a 422, nothing is written.
  const added = links.filter((id) => !(note.links ?? []).includes(id));
  if (added.length) {
    const targets = await tx.getAll(...added.map((id) => notesCol(db).doc(id)));
    for (const snap of targets) {
      const target = snap.data();
      if (
        !target ||
        target.deletedAt ||
        target.whiteboardId !== board.id ||
        !canSeeNote(target, actor.id)
      )
        throw new AppError(422, 'LINK_TARGET_INVALID', 'A link must name a note on this board');
    }
  }
}
```

and in the `changes` object add `...(links ? { links } : {})`. Import `applyLinkChanges` and `canSeeNote` from `../notes.js`. (`tx.getAll` with reads after the command's earlier reads is fine: Firestore transactions allow reads until the first write, and `executeNoteCommand` writes only after this switch.)

`apps/web/src/test/fixtures.ts` `makeNote`: add `links: [],` after `tags: [],`.

Run `pnpm --filter @wally/shared build && pnpm --filter @wally/api typecheck && pnpm --filter @wally/web typecheck` from the root; fix any `NoteDto` literal in web tests that the new required field breaks (search `tags: []` in `apps/web/src` test files and add `links: []` where a full `NoteDto` is spelled out).

- [ ] **Step 3: Route tests**

`apps/api/test/notes-links.test.ts` (project `wally-test-notes-links`; harness as `notes.test.ts`):

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { notesCol } from '../src/lib/db/collections.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-notes-links';

describe('note links', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID);
  });
  afterEach(() => resetDatabase(PROJECT_ID));
  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });

  const create = async (boardId: string, token: string, body: Record<string, unknown> = {}) =>
    (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${boardId}/notes`,
        headers: ctx.authHeader(token),
        payload: { title: 'Note', ...body },
      })
    ).json();
  const patch = (token: string, noteId: string, body: Record<string, unknown>) =>
    ctx.inject({
      method: 'PATCH',
      url: `/notes/${noteId}`,
      headers: ctx.authHeader(token),
      payload: body,
    });
  const stored = async (id: string) => (await notesCol(ctx.db).doc(id).get()).data()!;

  it('adds and removes links on the note’s current list and leaves the target alone', async () => {
    const fx = await createBoardFixture(ctx);
    const a = await create(fx.boardId, fx.ownerToken, { title: 'A' });
    const b = await create(fx.boardId, fx.ownerToken, { title: 'B' });
    const c = await create(fx.boardId, fx.editToken, { title: 'C' });
    let res = await patch(fx.ownerToken, a.id, { linkChanges: { add: [b.id, c.id, b.id] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().links).toEqual([b.id, c.id]);
    expect((await stored(b.id)).revision).toBe(b.revision);
    res = await patch(fx.ownerToken, a.id, { linkChanges: { remove: [b.id, 'nope'] } });
    expect(res.json().links).toEqual([c.id]);
    const list = (
      await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
      })
    ).json();
    expect(list.find((n: { id: string }) => n.id === a.id).links).toEqual([c.id]);
    expect(list.find((n: { id: string }) => n.id === b.id).links).toEqual([]);
  });

  it('refuses the note itself, a note elsewhere, a deleted note and another person’s private note', async () => {
    const fx = await createBoardFixture(ctx);
    const a = await create(fx.boardId, fx.ownerToken, { title: 'A' });
    const gone = await create(fx.boardId, fx.ownerToken, { title: 'Gone' });
    await ctx.inject({
      method: 'DELETE',
      url: `/notes/${gone.id}`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    const secret = await create(fx.boardId, fx.editToken, {
      title: 'Secret',
      visibility: 'PRIVATE',
    });
    // Another board: the editor's own board (a board's id is its owner's uid).
    await ctx.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(fx.editToken) });
    const elsewhere = await create(fx.editorId, fx.editToken, { title: 'Elsewhere' });
    for (const id of [a.id, gone.id, secret.id, elsewhere.id, 'missing-id']) {
      const res = await patch(fx.ownerToken, a.id, { linkChanges: { add: [id] } });
      expect(res.statusCode, id).toBe(422);
      expect(res.json().error).toBe('LINK_TARGET_INVALID');
    }
    expect((await stored(a.id)).links ?? []).toEqual([]);
    expect((await stored(a.id)).revision).toBe(a.revision);
  });

  it('caps the list at ten and keeps a viewer to their own private notes', async () => {
    const fx = await createBoardFixture(ctx);
    const a = await create(fx.boardId, fx.ownerToken, { title: 'A' });
    const ids: string[] = [];
    for (let i = 0; i < 11; i++)
      ids.push((await create(fx.boardId, fx.ownerToken, { title: `T${i}` })).id);
    expect(
      (await patch(fx.ownerToken, a.id, { linkChanges: { add: ids.slice(0, 10) } })).statusCode,
    ).toBe(200);
    expect(
      (await patch(fx.ownerToken, a.id, { linkChanges: { add: [ids[10]!] } })).statusCode,
    ).toBe(400);
    const mine = await create(fx.boardId, fx.viewToken, { title: 'Mine' });
    expect((await patch(fx.viewToken, mine.id, { linkChanges: { add: [a.id] } })).statusCode).toBe(
      200,
    );
    expect((await patch(fx.viewToken, a.id, { linkChanges: { add: [mine.id] } })).statusCode).toBe(
      403,
    );
  });
});
```

Run: `FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_PROJECT_ID=wally-local CORS_ORIGIN=http://localhost:5173 pnpm vitest run test/notes-links.test.ts` in `apps/api`. Expected: PASS. (If a viewer's create of a note on another's board is refused by the fixture roles, read `rolesFor` and adjust the last case to what a VIEW member may do: they may create private notes.)

- [ ] **Step 4: Checks and commit**

Lint, typecheck, format check; `pnpm vitest run` in `apps/web` (the fixture change).

```bash
git add packages/shared/src/constants.ts packages/shared/src/schemas/note.ts apps/api/src/lib/db/types.ts apps/api/src/lib/dto.ts apps/api/src/lib/notes.ts apps/api/src/lib/commands/notes.ts apps/api/test/notes-links.test.ts apps/web/src/test/fixtures.ts
git -c core.hooksPath=/dev/null commit -m "feat: a note links to related notes on its board, changed through note.update

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The suggestion contract grows a `links` field

**Files:**

- Modify: `packages/shared/src/schemas/assistant.ts`
- Modify: `apps/api/src/lib/db/types.ts` (`AssistantSuggestionDoc.fields.links`, `operationIds.links`, `decision.links`, `applied.links`)
- Modify: `apps/api/src/lib/assistant/suggestions.ts` (`mintOperationIds`, `toDto`, `proposedKeys` unchanged, the smallest edits that keep it compiling)
- Modify: `apps/web/src/test/fixtures.ts` (`makeSuggestionMark`: `fields.links: null`, mark `links: []`), `apps/web/src/features/board/Suggestions/pendingProps.ts`, `useSuggestions.ts` (the smallest edits that keep them compiling; Task 5 does the behaviour)

**Interfaces:**

- Produces (shared): `suggestionFieldKeys = [..., 'links']`; `SUGGESTION_MAX_LINKS = 3`; `suggestionFieldsSchema.links: { items: { noteId, title, reason }[]; reason } | null`; `suggestionDtoSchema.kept.links: number[]`; `suggestionDecisionSchema.links?: number[]`.
- Produces (API types): `fields.links?: { items: { noteId: string; reason: string }[]; reason: string } | null` (titles resolved at read time, L3), `operationIds.links?: { apply; undo }`, `decision.links?: number[]`, `applied.links?: number[]`, `applied.linkIds?: string[]`.

- [ ] **Step 1: Shared**

In `packages/shared/src/schemas/assistant.ts`: add `'links'` to `suggestionFieldKeys` (last); after `SUGGESTION_MAX_SUBTASKS`:

```ts
/** Related notes a proposal may name; more would be a map of the board, not a note. */
export const SUGGESTION_MAX_LINKS = 3;
```

In `suggestionFieldsSchema`, after `subtasks`:

```ts
  /**
   * Related notes on the board, one to three, each with the words that relate them (§3.4); the
   * title is the target's current one, read when the record is read (the plan's L3).
   */
  links: z
    .object({
      items: z
        .array(
          z.object({
            noteId: z.string(),
            title: z.string(),
            reason: reasonSchema,
          }),
        )
        .min(1)
        .max(SUGGESTION_MAX_LINKS),
      reason: reasonSchema,
    })
    .nullable(),
```

`suggestionDtoSchema.kept` gains `/** Which of the proposed links were written, by index. */ links: z.array(z.number().int().nonnegative()),`. `suggestionDecisionSchema` gains, after `subtasks`:

```ts
    /** For `keep` with `links` among the fields: the items to write, by index; omitted means all. */
    links: z
      .array(z.number().int().min(0).max(SUGGESTION_MAX_LINKS - 1))
      .max(SUGGESTION_MAX_LINKS)
      .optional(),
```

Build the shared package.

- [ ] **Step 2: Stored shape**

`apps/api/src/lib/db/types.ts`: `SuggestionOperationIds` gains `links?: { apply: string; undo: string };`. `AssistantSuggestionDoc.fields` gains `links?: { items: { noteId: string; reason: string }[]; reason: string } | null;`; `decision` gains `links?: number[]`; `applied` gains `/** The kept indexes of the proposed links, and the ids they named. */ links?: number[]; linkIds?: string[];`.

- [ ] **Step 3: The smallest compiling edits**

`suggestions.ts`: `mintOperationIds` adds `links: { apply: randomUUID(), undo: randomUUID() }`; `candidates`, `accept` and the chain leave `links` alone for now (`accept` returns `links: null`); `toDto` resolves titles:

```ts
// A proposed link reads with its target's current title; a target gone from the board drops out (L3, L7).
const linkIds = live.links?.items.map((item) => item.noteId) ?? [];
const targets = linkIds.length ? await db.getAll(...linkIds.map((id) => notesCol(db).doc(id))) : [];
const titles = new Map(
  targets.flatMap((snap) => {
    const data = snap.data();
    return data && !data.deletedAt && data.whiteboardId === board.id ? [[snap.id, data.title]] : [];
  }),
);
const links =
  live.links && live.links.items.some((item) => titles.has(item.noteId))
    ? {
        items: live.links.items.flatMap((item) =>
          titles.has(item.noteId) ? [{ ...item, title: titles.get(item.noteId)! }] : [],
        ),
        reason: live.links.reason,
      }
    : null;
```

and `fields.links = links`, `kept.links = doc.applied.links ?? []`. (`notesCol` is imported already; a `withConverter` snapshot's `data()` is a `NoteDoc`.) The capture writes `links: null` into `fields`.

Web: `pendingProps.ts` `NONE` gains `links: null` and `ProposedValues` follows the enum (the `subtasks` special case gains a sibling: `links: (Proposed<'links'> & { kept: number[] }) | null`, returned as `null` in `proposedValues` for now); `useSuggestions.ts` `SuggestionMark` gains `/** The proposed links still in the change, by index; all of them at first. */ links: number[];` set to `[]` wherever a mark is built (and `suggestion.fields.links ? items.map((_, i) => i) : []` in `showPending`); `proposed()` excludes nothing new; `fixtures.ts` `makeSuggestionMark` gains `fields.links: null` and `links: []`.

Run typechecks (API and web), the shared build, `pnpm vitest run src/features/board/Suggestions/useSuggestions.test.tsx src/features/board/Suggestions/pendingProps.test.ts` in `apps/web`, and `test/assistant-suggestions.test.ts` in `apps/api` (emulator, one file): PASS unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/schemas/assistant.ts apps/api/src/lib/db/types.ts apps/api/src/lib/assistant/suggestions.ts apps/web/src/test/fixtures.ts apps/web/src/features/board/Suggestions/pendingProps.ts apps/web/src/features/board/Suggestions/useSuggestions.ts
git -c core.hooksPath=/dev/null commit -m "feat(shared): a suggestion may name related notes, kept one by one

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The model proposes related notes

**Files:**

- Modify: `apps/api/src/lib/assistant/model/suggest.ts`, `suggest.test.ts`
- Modify: `apps/api/src/lib/assistant/model/types.ts` (`ModelSuggestion.links`)
- Modify: `apps/api/src/lib/assistant/capturePrompt.ts`, `capturePrompt.test.ts`
- Modify: `apps/api/src/lib/assistant/suggestions.ts` (`candidates`, `accept`, `suggestForCapture`)
- Modify: `apps/api/test/assistant-suggestions.test.ts` (the fake runner and two propose cases)

**Interfaces:**

- Produces (model): `ModelSuggestion.links: { items: { noteId: string; reason: string }[]; confidence: number; reason: string } | null`; the wire schema's `links` with `maxItems: SUGGESTION_MAX_LINKS`; the checked schema drops a bad item alone (`.catch(null)` on the field, items trimmed, blank ids dropped, cut to three).
- Produces (prompt): `buildCapturePrompt` gains `notes: { id: string; title: string }[]` and writes `Other notes on this board:\n<id>: <title>` or `Other notes on this board: none`; `CAPTURE_INSTRUCTIONS_PREFIX` gains the `links` line; `CAPTURE_MAX_OTHER_NOTES = 40`.
- Produces (service): `candidates` adds `'links'` when the note has no links and `!locked.includes('links')`; `accept` gains `others: Map<string, string>` (id → title of the rows sent) and returns `links` when confident, among the rows, not the note, each once, at most three; `suggestForCapture` reads the board's open notes (`listNotes … { status: 'OPEN' }`), newest first, without the note itself, at most 40, only when `'links'` is open.

- [ ] **Step 1: Prompt, test first**

Add to `capturePrompt.test.ts`:

```ts
it('lists the other notes as data, one per line, or says there are none', () => {
  const prompt = buildCapturePrompt({
    title: 'Call Müller about the quote',
    description: '',
    members: [],
    fieldKeys: [],
    notes: [
      { id: 'n2', title: 'Quote for Müller GmbH' },
      { id: 'n3', title: 'Team lunch' },
    ],
  });
  expect(prompt).toContain('Other notes on this board:\nn2: Quote for Müller GmbH\nn3: Team lunch');
  expect(
    buildCapturePrompt({ title: 'x', description: '', members: [], fieldKeys: [], notes: [] }),
  ).toContain('Other notes on this board: none');
});

it('tells the model what a link is and that it names ids from the list only', () => {
  expect(CAPTURE_INSTRUCTIONS_PREFIX).toContain('links:');
  expect(CAPTURE_INSTRUCTIONS_PREFIX).toContain('Only ids from the list of other notes');
});
```

Every existing call of `buildCapturePrompt` in that file gains `notes: []`. Run: FAIL (missing property).

`capturePrompt.ts`: the prefix gains, after the `subtasks:` line:

```ts
  'links: one to three of the other notes on this board that this note is about the same thing as (the same customer, project, document or event named in both), each by its id with the words that relate them. Only ids from the list of other notes; otherwise null.',
```

The first line's list of what to fill in gains `, and the other notes it is related to`. `buildCapturePrompt`'s input gains `notes: { id: string; title: string }[]` and, after the properties block:

```ts
lines.push(
  input.notes.length
    ? `Other notes on this board:\n${input.notes.map((n) => `${n.id}: ${n.title}`).join('\n')}`
    : 'Other notes on this board: none',
);
```

Export `export const CAPTURE_MAX_OTHER_NOTES = 40;` with the comment "Rows of other notes one capture call reads; the newest ones go first." The existing test that asserts the prompt ends with the properties block (`prompt.endsWith('Properties on this board:…')`) changes to assert the properties block is followed by the notes line. Run: PASS.

- [ ] **Step 2: The model schema, test first**

Add to `suggest.test.ts` (follow its existing cases for `modelSuggestionSchema`):

```ts
it('keeps up to three links to listed ids and drops a blank one; a bad list drops alone', () => {
  const good = modelSuggestionSchema.parse({
    ...nothing,
    links: {
      items: [
        { noteId: ' n2 ', reason: 'same customer' },
        { noteId: '', reason: 'blank' },
        { noteId: 'n3', reason: 'x'.repeat(200) },
        { noteId: 'n4', reason: 'four' },
        { noteId: 'n5', reason: 'five' },
      ],
      confidence: 0.8,
      reason: 'related',
    },
  });
  expect(good.links?.items.map((i) => i.noteId)).toEqual(['n2', 'n3', 'n4']);
  expect(good.links?.items[1]!.reason).toHaveLength(120);
  const bad = modelSuggestionSchema.parse({
    ...nothing,
    dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Friday' },
    links: { items: 'not a list', confidence: 0.8, reason: 'odd' },
  });
  expect(bad.links).toBeNull();
  expect(bad.dueDate?.value).toBe('2026-10-23');
});

it('sends maxItems on the links list and no string keywords', async () => {
  const json = JSON.parse(await suggestionSchemaJson());
  expect(
    json.properties.links.anyOf?.[0]?.properties?.items?.maxItems ??
      json.properties.links.properties?.items?.maxItems,
  ).toBe(3);
});
```

(`nothing` is the file's all-null reply; if it is named differently, use that name. For the second assertion, read how the file's existing `maxItems: 5` assertion on `subtasks.items` finds the property and copy that path.) Run: FAIL.

`suggest.ts`: wire schema gains, after `subtasks`:

```ts
  links: z
    .object({
      items: z
        .array(z.object({ noteId: z.string(), reason: z.string() }))
        .max(SUGGESTION_MAX_LINKS)
        .describe('One to three other notes from the list, by id, each with why.'),
      confidence,
      reason: z.string(),
    })
    .nullable(),
```

checked schema gains:

```ts
const linkItems = z
  .array(z.object({ noteId: z.string(), reason: z.string() }))
  .transform((items) => {
    const seen = new Set<string>();
    const out: { noteId: string; reason: string }[] = [];
    for (const item of items) {
      const noteId = item.noteId.trim();
      if (!noteId || seen.has(noteId)) continue;
      seen.add(noteId);
      out.push({ noteId, reason: item.reason.slice(0, SUGGESTION_REASON_MAX) });
    }
    return out.slice(0, SUGGESTION_MAX_LINKS);
  })
  .pipe(z.array(z.object({ noteId: z.string().min(1), reason: z.string() })).min(1));
…
  links: z.object({ items: linkItems, confidence, reason }).nullable().catch(null),
```

(import `SUGGESTION_MAX_LINKS` from `@wally/shared`.) `types.ts` `ModelSuggestion` gains `links: { items: { noteId: string; reason: string }[]; confidence: number; reason: string } | null;`. Run the test file and `boundary.test.ts`: PASS. The fake runners in `assistant-suggestions.test.ts` spell every field: their `noProposal` gains `links: null` (Step 4).

- [ ] **Step 3: Candidates, the rows and the acceptance**

`suggestions.ts`:

`candidates` gains the field `'links'` to its note pick and the rule `if ((note.links ?? []).length === 0 && !locked.includes('links')) open.push('links');` (`NoteDetailDto` has `links` from Task 1).

`accept` gains a parameter `others: Map<string, string>` (the rows sent, id → title) and the key:

```ts
    links:
      open.includes('links') && fields.links && sure(fields.links.confidence)
        ? acceptLinks(fields.links, others)
        : null,
```

with

```ts
/** Only notes from the rows the model saw, each once, at most three: a link is never invented (L3). */
function acceptLinks(
  links: NonNullable<ModelSuggestion['links']>,
  others: Map<string, string>,
): NonNullable<AssistantSuggestionDoc['fields']['links']> | null {
  const items = links.items
    .filter((item) => others.has(item.noteId))
    .slice(0, SUGGESTION_MAX_LINKS)
    .map((item) => ({ noteId: item.noteId, reason: item.reason }));
  return items.length ? { items, reason: links.reason } : null;
}
```

`suggestForCapture`: the board's notes are read once when either a reference or links may be proposed:

```ts
const needsBoard = open.includes('reference') || open.includes('links');
const boardNotes = needsBoard ? await listNotes(db, actor, board.id, { status: 'ALL' }) : [];
const fieldKeys = open.includes('reference') ? collectKeys(boardNotes, ctx.language) : [];
// The other open notes, newest first, as `id: title` rows: what a link may name (L3).
const otherNotes = open.includes('links')
  ? boardNotes
      .filter((n) => n.id !== note.id && n.status === 'OPEN')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, CAPTURE_MAX_OTHER_NOTES)
      .map((n) => ({ id: n.id, title: n.title }))
  : [];
```

`buildCapturePrompt({ …, notes: otherNotes })`; `accept(output.fields, open, memberIds, request.today, note, fieldKeys, new Map(otherNotes.map((n) => [n.id, n.title])))`. The existing route test "reads no board keys for a note that has a property already" still holds when the note also has links, so give that test's note a link in Step 4 (or assert `Other notes on this board: none` only when `links` is not open); adjust as the brief's tests say.

- [ ] **Step 4: Route tests**

In `assistant-suggestions.test.ts`: `noProposal` gains `links: null`; a new branch in the fake runner:

```ts
// Links: the second line of the prompt's "Other notes" block names the note to relate.
if (title.startsWith('related')) {
  const block = input.prompt.split('Other notes on this board:\n')[1] ?? '';
  const ids = block
    .split('\n')
    .map((line) => line.split(': ')[0]!)
    .filter(Boolean);
  return settle({
    dueDate: null,
    priority: null,
    assignee: null,
    title: null,
    reference: null,
    subtasks: null,
    links: {
      items: [
        { noteId: ids[0] ?? 'none', reason: 'same customer' },
        { noteId: ids[0] ?? 'none', reason: 'twice' },
        { noteId: 'not-on-board', reason: 'invented' },
      ],
      confidence: 0.9,
      reason: 'related',
    },
  });
}
```

Cases:

```ts
it('proposes links to the other open notes the model names, once each, with their titles', async () => {
  const fx = await createBoardFixture(ctx);
  const other = (await createNote(fx.ownerToken, fx.boardId, { title: 'Quote for Müller' })).json();
  await createNote(fx.ownerToken, fx.boardId, { title: 'Done one', status: 'DONE' });
  const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'related: call Müller' })).json();
  const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
  expect(suggestion.fields.links).toEqual({
    items: [{ noteId: other.id, title: 'Quote for Müller', reason: 'same customer' }],
    reason: 'related',
  });
  expect(lastInput?.prompt).toContain(`Other notes on this board:\n${other.id}: Quote for Müller`);
  expect(lastInput?.prompt).not.toContain(n.id + ':');
});

it('proposes no links on a note that already has one, and the prompt lists no other notes then', async () => {
  const fx = await createBoardFixture(ctx);
  const other = (await createNote(fx.ownerToken, fx.boardId, { title: 'Quote' })).json();
  const n = (
    await createNote(fx.ownerToken, fx.boardId, { title: 'related: linked already' })
  ).json();
  await patchNote(fx.ownerToken, n.id, { linkChanges: { add: [other.id] } });
  const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
  expect(suggestion?.fields.links ?? null).toBeNull();
  expect(lastInput?.prompt).toContain('Other notes on this board: none');
});
```

(`createNote` with `status: 'DONE'` is not a create field: complete that note through its route instead, as the file does elsewhere, or drop the done note from the case. `patchNote` is `patchTitle`'s general form: add it.) Run the file (emulator, one file). Expected: PASS, and every earlier case still green.

- [ ] **Step 5: Checks and commit**

`pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint && pnpm format:check`; `boundary.test.ts`.

```bash
git add apps/api/src/lib/assistant/model/suggest.ts apps/api/src/lib/assistant/model/suggest.test.ts apps/api/src/lib/assistant/model/types.ts apps/api/src/lib/assistant/capturePrompt.ts apps/api/src/lib/assistant/capturePrompt.test.ts apps/api/src/lib/assistant/suggestions.ts apps/api/test/assistant-suggestions.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(api): the capture turn proposes related notes from the board’s own rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The record keeps and undoes the links

**Files:**

- Modify: `apps/api/src/lib/assistant/suggestions.ts` (`FieldValues`, `proposedValues`, `restoredValues`, `beforeKeep`, `stepCall`, `stillWritten`, `stepsFor`, `decideSuggestion`, `completeKeep`)
- Modify: `apps/api/test/assistant-suggestions.test.ts`

**Interfaces:**

- Produces: a keep with `links` among the fields and `decision.links` indexes writes one `update_note { linkChanges: { add } }` step under `operationIds.links.apply`; undo writes `{ remove }` under `.undo`; `applied.links` (indexes) and `applied.linkIds` (the ids written, in index order).

- [ ] **Step 1: Tests first**

```ts
it('keeps two of three proposed links in one write, replays once, and undo removes exactly them', async () => {
  const fx = await createBoardFixture(ctx);
  const a = (await createNote(fx.ownerToken, fx.boardId, { title: 'A' })).json();
  const b = (await createNote(fx.ownerToken, fx.boardId, { title: 'B' })).json();
  const c = (await createNote(fx.ownerToken, fx.boardId, { title: 'C' })).json();
  const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'threelinks' })).json();
  const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
  expect(suggestion.fields.links.items.map((i: { noteId: string }) => i.noteId)).toEqual([
    c.id,
    b.id,
    a.id,
  ]);
  const kept = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'keep',
    fields: ['links'],
    links: [0, 2],
    source: 'click',
  });
  expect(kept.statusCode).toBe(200);
  expect(kept.json().suggestion.kept).toMatchObject({ fields: ['links'], links: [0, 2] });
  expect((await note(n.id)).links).toEqual([c.id, a.id]);
  expect((await note(n.id)).revision).toBe(n.revision + 1);
  expect(await audits(fx.ownerId)).toBe(1);
  await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'keep',
    fields: ['links'],
    links: [0, 2],
    source: 'click',
  });
  expect((await note(n.id)).revision).toBe(n.revision + 1);
  const undone = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'undo',
    source: 'click',
  });
  expect(undone.json().suggestion.status).toBe('UNDONE');
  expect((await note(n.id)).links).toEqual([]);
});

it('a link added by hand after the keep moves the revision, so the undo is refused and every link stays', async () => {
  // Same setup and keep of [0, 2] as above, then:
  await patchNote(fx.ownerToken, n.id, { linkChanges: { add: [b.id] } });
  const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
    decision: 'undo',
    source: 'click',
  });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('STALE_REVISION');
  expect((await note(n.id)).links).toEqual([c.id, a.id, b.id]);
});
```

The undo runs on the kept revision (0005-wallybot-inline.md §4, L4), as the subtask undo does ("a kept step deleted by hand moves the revision, so the undo is refused and adds nothing"); the hand link refuses it. These tests may run as the editor where the owner's captures in the file reach the capture route's limit of 30 a minute.

The fake runner gains a `threelinks` branch that names the first three ids of the "Other notes" block (newest first, so `c, b, a`) with confidence 0.9. Add an `audits` helper counting `assistantAuditCol(ctx.db)` rows if the file has none. Run: FAIL (the links are not written).

- [ ] **Step 2: The chain**

In `suggestions.ts`:

`FieldValues` gains `links: string[]` (the ids to add on a keep, or to remove on an undo). `proposedValues(doc)` sets `links: (doc.fields.links?.items ?? []).map((i) => i.noteId)`; but a keep writes only the kept indexes: give `completeKeep` the kept indexes for links as it has for subtasks (`keptLinks = kept.includes('links') ? sorted(doc.decision?.links ?? []) : []`) and pass `written = { ...proposedValues(doc), links: keptLinks.map((i) => items[i]!.noteId) }`. `restoredValues(before, keptIndexes, subtaskIds, linkIds)` gains `links: linkIds` (what the undo removes). `beforeKeep` leaves `before` unchanged (the note had no links at the base, L4).

`stepsFor` treats `links` as one step (no expansion). `stepCall`:

```ts
    case 'links':
      return {
        name: 'update_note',
        input: {
          ...at,
          input: {
            linkChanges: direction === 'apply' ? { add: values.links } : { remove: values.links },
          },
        },
      };
```

`stepCall` needs to know the direction: add a parameter `direction: 'apply' | 'undo'` and pass it from `runChain` (which already knows it through `ids`; give `runChain` a `direction` argument and forward it) and from `revertWrites` (`'undo'` when reverting a keep's writes, `'apply'` when reverting an undo's). Alternatively encode the direction in the values: `links: { add: string[] } | { remove: string[] }`; pick one and apply it consistently (the brief's tests only see the result).

`stillWritten` for `links`: `written.links.every((id) => (note.links ?? []).includes(id))` when checking a keep's write; for an undo's inverse the restore holds the ids to remove and the check is that none of them is on the note. `decideSuggestion`'s keep branch validates `decision.links` like `subtasks` (`unique`, `< items.length`, sorted; none left drops `'links'` from `fields`); `applied` records `links: keptLinks, linkIds: written.links`. The undo branch builds `restore` with `applied.linkIds ?? []`.

Run the file (emulator). Expected: PASS, every case.

- [ ] **Step 3: Checks and commit**

`pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint && pnpm format:check`.

```bash
git add apps/api/src/lib/assistant/suggestions.ts apps/api/test/assistant-suggestions.test.ts
git -c core.hooksPath=/dev/null commit -m "feat(api): a keep writes the ticked links in one update and undo takes them back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The web controller, the card and the review learn the links

**Files:**

- Modify: `apps/web/src/features/board/Suggestions/pendingProps.ts`, `pendingProps.test.ts`
- Modify: `apps/web/src/features/board/Suggestions/useSuggestions.ts`, `useSuggestions.test.tsx`
- Modify: `apps/web/src/features/board/Suggestions/usePendingFor.ts`
- Modify: `apps/web/src/features/board/WallView/NoteCard.tsx`, `NoteCard.test.tsx`
- Modify: `apps/web/src/features/board/ListView/NoteRow.tsx` (the related count in the meta row)
- Modify: `apps/web/src/features/board/NoteDetail/PendingReview.tsx`, `PendingReview.test.tsx`
- Modify: `apps/web/src/i18n/de.ts`, `apps/web/src/i18n/en.ts`

**Interfaces:**

- Produces: `PendingProps.onSetLink(index: number, on: boolean)`; `SuggestionsController.setLink(noteId, index, on)`; `proposedValues(...).links: (Proposed<'links'> & { kept: number[] }) | null` (only on a note with no links, L3); `keepBody` carries `links` when `links` is among the fields; the decision `links` indexes; catalogue keys `suggest.fields.links_one/_other`, `suggest.fields.link`, `suggest.review.rowLink`, `note.related.count_one/_other`.

- [ ] **Step 1: Catalogue**

`de.ts`, in `suggest.fields`: `link: 'Verwandt: {{title}}', links_one: '{{count}} verwandte Notiz', links_other: '{{count}} verwandte Notizen'`; in `suggest.review`: `rowLink: 'Verwandt: {{title}}'`. In `note`, a new block (Task 6 adds the rest of it):

```ts
    related: {
      count_one: '{{count}} verwandt',
      count_other: '{{count}} verwandt',
    },
```

`en.ts`: `link: 'Related: {{title}}'`, `links_one: '{{count}} related note'`, `links_other: '{{count}} related notes'`, `rowLink: 'Related: {{title}}'`, `related.count_one: '{{count}} related'`, `related.count_other: '{{count}} related'`.

- [ ] **Step 2: `pendingProps`, tests first**

Add to `pendingProps.test.ts` (follow the file's existing `proposedValues` cases):

```ts
it('offers the proposed links, with the ticked indexes, only on a note without links', () => {
  const links = {
    items: [
      { noteId: 'b', title: 'B', reason: 'same' },
      { noteId: 'c', title: 'C', reason: 'same' },
    ],
    reason: 'r',
  };
  const mark = makeSuggestionMark({ fields: ['links'], links: [1] });
  mark.suggestion!.fields.links = links;
  const pending = { ...props(mark) };
  expect(proposedValues(makeNote({ links: [] }), pending).links).toEqual({ ...links, kept: [1] });
  expect(proposedValues(makeNote({ links: ['z'] }), pending).links).toBeNull();
});
```

(`props(mark)` is whatever helper the file uses to build a `PendingProps` from a mark; it gains `onSetLink: vi.fn()`.) Run: FAIL.

`pendingProps.ts`: `PendingProps` gains `/** Ticks one proposed link in or out, by its index. */ onSetLink: (index: number, on: boolean) => void;`; `proposedValues` returns

```ts
    links:
      has('links') && note.links.length === 0 && fields.links
        ? { ...fields.links, kept: mark.links }
        : null,
```

Run: PASS.

- [ ] **Step 3: The controller, tests first**

Add to `useSuggestions.test.tsx` a case next to the `setSubtask` ones: a proposal with two links (`fields.links.items` of two) starts with `links: [0, 1]` in the mark; `setLink('n1', 0, false)` leaves `[1]`; `setLink('n1', 1, false)` takes `'links'` out of the fields; `setLink('n1', 0, true)` puts `'links'` back with `[0]` alone; a keep sends `links: [0]` in the body. Run: FAIL.

`useSuggestions.ts`: `keepBody(fields, subtasks, links, source)` adds `...(fields.includes('links') ? { links } : {})`; every caller passes `mark.links`; `SuggestionMark.links` is set in `showPending` from the items (Task 2 did this); `setLink` is `setSubtask` with `links` in place of `subtasks` and `mark.suggestion?.fields.links?.items` as the list; `choose(noteId, mark, fields, subtasks, links)` gains the parameter; `setField(noteId, 'links', true)` with none ticked ticks all back (as `subtasks`). Export `setLink` on the controller. `usePendingFor.ts` adds `onSetLink: (index, on) => suggestions.setLink(noteId, index, on)`. Run the controller tests: PASS; `usePendingFor.test.tsx`: PASS (its fixture `PendingProps` gain the handler if they spell one out).

- [ ] **Step 4: The card and the row**

`NoteCard.tsx`: after the reference line, one line per ticked proposed link:

```tsx
{
  proposed.links &&
    proposed.links.items.map((item, index) =>
      proposed.links!.kept.includes(index) ? (
        <ProposedField
          key={item.noteId}
          className="-mt-1"
          name={t('suggest.fields.link', { title: item.title || t('common.untitled') })}
          label={
            <span className="line-clamp-1 text-12 leading-snug text-fg-meta-on-note">
              {t('suggest.fields.link', { title: item.title || t('common.untitled') })}
            </span>
          }
          reason={item.reason}
          onRemove={removable ? () => pending?.onSetLink(index, false) : undefined}
        />
      ) : null,
    );
}
```

In the meta row, after the subtask count (and the proposed steps block), the related count for a note that has links:

```tsx
{
  note.links.length > 0 && (
    <span className="flex items-center gap-1 text-12 font-medium tabular-nums text-fg-meta-on-note">
      <Link2 className="h-3 w-3 shrink-0" strokeWidth={1.9} />
      {t('note.related.count', { count: note.links.length })}
    </span>
  );
}
```

(`Link2` from lucide-react is not among the banned icons.) `NoteRow.tsx`: the same count in its meta line, following how it shows the subtask count. Tests in `NoteCard.test.tsx`: a pending proposal with two links ticked shows two "Related: …" lines and the × of the first calls `onSetLink(0, false)`; a note with two links shows "2 related"; a note with none shows nothing. Run: PASS.

- [ ] **Step 5: The review**

`PendingReview.tsx`: after the steps rows,

```ts
offered.links?.items.forEach((item, index) => {
  added.push({
    key: `link-${index}`,
    label: t('suggest.review.rowLink', { title: item.title || t('common.untitled') }),
    checked: ticked('links') && mark.links.includes(index),
    onCheckedChange: (on) => pending.onSetLink(index, on),
  });
});
```

Test in `PendingReview.test.tsx`: two link rows, the second unticked when `mark.links = [0]`, ticking it calls `onSetLink(1, true)`. Run: PASS.

- [ ] **Step 6: Checks and commit**

Guard tests, lint, typecheck, format check, the whole web suite.

```bash
git add apps/web/src/features/board/Suggestions apps/web/src/features/board/WallView/NoteCard.tsx apps/web/src/features/board/WallView/NoteCard.test.tsx apps/web/src/features/board/ListView/NoteRow.tsx apps/web/src/features/board/NoteDetail/PendingReview.tsx apps/web/src/features/board/NoteDetail/PendingReview.test.tsx apps/web/src/i18n/de.ts apps/web/src/i18n/en.ts
git -c core.hooksPath=/dev/null commit -m "feat(web): proposed links on the card and in the review, ticked one by one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Related notes in the panel

**Files:**

- Create: `apps/web/src/features/board/hooks/mutations/useLinkMutations.ts`, `useLinkMutations.test.tsx`
- Create: `apps/web/src/features/board/NoteDetail/RelatedNotes.tsx`, `RelatedNotes.test.tsx`
- Modify: `apps/web/src/features/board/NoteDetail/NoteDetailPanel.tsx`, `NoteDetailPanel.test.tsx`
- Modify: `apps/web/src/features/board/util/noteDerived.ts` (`relatedNotes`)
- Modify: `apps/web/src/i18n/de.ts`, `apps/web/src/i18n/en.ts`

**Interfaces:**

- Produces: `useAddLink(boardId)` / `useRemoveLink(boardId)` (`mutate({ noteId, targetId })`, optimistic on `links`, mirroring `useAddTag`/`useRemoveTag` with `linkChanges`); `relatedNotes(note, notes): { note: NoteDto; direction: 'out' | 'in' }[]` (the note's own links first, then the notes linking to it, each resolved against the board's notes, L7); `RelatedNotes({ note, notes, disabled, onOpen, onAdd, onRemove })`.

- [ ] **Step 1: Catalogue**

`de.ts` `note.related` gains: `label: 'Verwandte Notizen'`, `add: 'Notiz verknüpfen…'`, `search: 'Notiz suchen'`, `empty: 'Keine passende Notiz'`, `remove: 'Verknüpfung zu {{title}} entfernen'`, `fromOther: 'Verknüpft von {{title}}'`, `linked: 'Verknüpft mit {{title}}'`. `en.ts`: `label: 'Related notes'`, `add: 'Link a note…'`, `search: 'Search notes'`, `empty: 'No matching note'`, `remove: 'Remove the link to {{title}}'`, `fromOther: 'Linked from {{title}}'`, `linked: 'Linked to {{title}}'`.

- [ ] **Step 2: The mutations, tests first**

`useLinkMutations.test.tsx` mirrors `useCustomFieldMutations.test.tsx`: `useAddLink` sends `{ linkChanges: { add: ['b'] } }` through `notesApi.update` and patches the cached note's `links` to include `'b'` at once; a failure restores the list; `useRemoveLink` sends `{ linkChanges: { remove: ['b'] } }` and patches it out. Run: FAIL.

`useLinkMutations.ts` is `useTagMutations.ts` with `links` for `tags`, `targetId` for `tag`, `linkChanges` for `tagChanges`, and `currentLinks` reading `links` from the cached list. Run: PASS.

- [ ] **Step 3: The derived relation**

`noteDerived.ts`:

```ts
/**
 * What a note is related to, both ways (the plan's L1, L6): the notes it links to, in its own
 * order, then the notes that link to it. Resolved against the board's notes, so an id whose
 * note is gone or out of sight is dropped (L7).
 */
export function relatedNotes(
  note: Pick<NoteDto, 'id' | 'links'>,
  notes: readonly NoteDto[],
): { note: NoteDto; direction: 'out' | 'in' }[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const out = note.links.flatMap((id) => {
    const target = byId.get(id);
    return target ? [{ note: target, direction: 'out' as const }] : [];
  });
  const seen = new Set(note.links);
  const incoming = notes
    .filter((n) => n.id !== note.id && n.links.includes(note.id) && !seen.has(n.id))
    .map((n) => ({ note: n, direction: 'in' as const }));
  return [...out, ...incoming];
}
```

A test in `noteDerived.test.ts`: own links first in order, then backlinks, an unresolvable id dropped, a note that links both ways listed once.

- [ ] **Step 4: The section, tests first**

`RelatedNotes.test.tsx` (rendered with `renderWithProviders`): shows one row per related note with the title, an × only on own links (`'Remove the link to B'`), the backlink's row titled `'Linked from C'` with no ×; "Link a note…" opens a list without the note itself, the already linked notes or a done note; typing filters by title; picking calls `onAdd('d')`; `disabled` hides the button and the ×s; a row click calls `onOpen`. Run: FAIL.

`RelatedNotes.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { NoteDto } from '@wally/shared';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RemoveButton } from '@/components/ui/remove-button';
import { cn } from '@/lib/cn';
import { PriorityIcon } from '../PriorityIcon';
import { dueInfo, dueToneClass, relatedNotes } from '../util/noteDerived';
import { FieldLabel } from './Field';

/**
 * The notes this one is related to, both ways (0005-wallybot-inline.md §3.4, plan L6): a row per
 * note as the answer card lists them, an × on the note's own links, the direction in the
 * row's tooltip, and a picker to link another note of the board. No colour, no badge.
 */
export function RelatedNotes({
  note,
  notes,
  disabled,
  onOpen,
  onAdd,
  onRemove,
}: {
  note: NoteDto;
  /** The board's notes, from the cache the panel already reads. */
  notes: NoteDto[];
  disabled: boolean;
  onOpen: (noteId: string) => void;
  onAdd: (targetId: string) => void;
  onRemove: (targetId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const related = useMemo(() => relatedNotes(note, notes), [note, notes]);
  const linked = useMemo(() => new Set(related.map((r) => r.note.id)), [related]);
  const choices = useMemo(
    () => notes.filter((n) => n.id !== note.id && n.status === 'OPEN' && !linked.has(n.id)),
    [linked, note.id, notes],
  );
  if (related.length === 0 && disabled) return null;
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>{t('note.related.label')}</FieldLabel>
      {related.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-border">
          {related.map(({ note: other, direction }) => {
            const title = other.title || t('common.untitled');
            const due = dueInfo(other, t);
            return (
              <li
                key={other.id}
                className="flex items-center border-b border-border-subtle last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => onOpen(other.id)}
                  title={t(direction === 'out' ? 'note.related.linked' : 'note.related.fromOther', {
                    title,
                  })}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left',
                    'transition-colors duration-120 hover:bg-surface-alt',
                    'focus-visible:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ring-alpha)]',
                    '[@media(pointer:coarse)]:min-h-11',
                  )}
                >
                  <PriorityIcon priority={other.priority} className="shrink-0 text-fg-3" />
                  <span className="min-w-0 flex-1 truncate text-13 font-medium text-fg-1">
                    {title}
                  </span>
                  <span className={cn('shrink-0 text-12', dueToneClass[due.tone])}>
                    {due.label}
                  </span>
                </button>
                {!disabled && direction === 'out' && (
                  <RemoveButton
                    label={t('note.related.remove', { title })}
                    onClick={() => onRemove(other.id)}
                    className="mr-1"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!disabled && choices.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="self-start text-fg-3">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('note.related.add')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <Command>
              <CommandInput
                placeholder={t('note.related.search')}
                aria-label={t('note.related.search')}
              />
              <CommandList>
                <CommandEmpty>{t('note.related.empty')}</CommandEmpty>
                <CommandGroup>
                  {choices.map((choice) => (
                    <CommandItem
                      key={choice.id}
                      value={`${choice.title} ${choice.id}`}
                      onSelect={() => {
                        onAdd(choice.id);
                        setOpen(false);
                      }}
                    >
                      <PriorityIcon priority={choice.priority} className="shrink-0 text-fg-3" />
                      <span className="min-w-0 flex-1 truncate">
                        {choice.title || t('common.untitled')}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
```

(Check `RemoveButton`'s props in `components/ui/remove-button.tsx` and `PriorityIcon`'s; use their real names. `PriorityIcon` inside the row is decorative here: give it `aria-hidden` if its label prop is required.) Run the test: PASS.

- [ ] **Step 5: In the panel**

`NoteDetailPanel.tsx`: `const addLink = useAddLink(boardId); const removeLink = useRemoveLink(boardId);`; a new `PanelSection` between the properties section and the custom fields section:

```tsx
<PanelSection>
  <RelatedNotes
    note={note}
    notes={boardNotes ?? []}
    disabled={disabled}
    onOpen={onOpenNote}
    onAdd={(targetId) => addLink.mutate({ noteId: note.id, targetId })}
    onRemove={(targetId) => removeLink.mutate({ noteId: note.id, targetId })}
  />
</PanelSection>
```

The panel needs `onOpenNote: (noteId: string) => void`: add it to `NoteDetailPanel`'s and `NoteDetailContent`'s props and pass `viewState.openNote` from `AppShell` (opening another note replaces the panel's note; the URL's `note` param changes in place, as `openNote` already does for an open note). `NoteDetailPanel.test.tsx`: one case with `notesApi.list` returning two notes where one links to the open note: the section shows "Linked from …" and the picker offers the other; `renderPanel` gains `onOpenNote: vi.fn()`. Run: PASS.

- [ ] **Step 6: Checks and commit**

Guard tests, lint, typecheck, format check, the whole web suite.

```bash
git add apps/web/src/features/board/hooks/mutations/useLinkMutations.ts apps/web/src/features/board/hooks/mutations/useLinkMutations.test.tsx apps/web/src/features/board/NoteDetail/RelatedNotes.tsx apps/web/src/features/board/NoteDetail/RelatedNotes.test.tsx apps/web/src/features/board/NoteDetail/NoteDetailPanel.tsx apps/web/src/features/board/NoteDetail/NoteDetailPanel.test.tsx apps/web/src/features/board/util/noteDerived.ts apps/web/src/features/board/util/noteDerived.test.ts apps/web/src/features/board/AppShell.tsx apps/web/src/i18n/de.ts apps/web/src/i18n/en.ts
git -c core.hooksPath=/dev/null commit -m "feat(web): the panel lists related notes both ways and links another from a picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Hairlines on the free canvas

**Files:**

- Create: `apps/web/src/features/board/WallView/LinkLines.tsx`, `LinkLines.test.tsx`
- Modify: `apps/web/src/features/board/WallView/WallCanvas.tsx`, `WallCanvas.test.tsx`

**Interfaces:**

- Produces: `LinkLines({ notes, pendingFor })` rendering an `<svg data-link-lines>` of `FREE_CANVAS_WIDTH × FREE_CANVAS_HEIGHT` under the cards: a `<line data-link="a:b" data-pending>` (dashed) per ticked proposed link of a note whose mark is pending, a `<line data-link="a:b">` (solid) per kept link whose target is on the canvas; each unordered pair once; `cardCentre(note): { x: number; y: number }`.

- [ ] **Step 1: Tests first**

`LinkLines.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { NOTE_CARD_HEIGHT, NOTE_CARD_WIDTH } from '@wally/shared';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { PendingProps } from '../Suggestions/pendingProps';
import { LinkLines } from './LinkLines';

const a = makeNote({ id: 'a', freeX: 0, freeY: 0, links: ['b'] });
const b = makeNote({ id: 'b', freeX: 400, freeY: 300, links: ['a'] });
const c = makeNote({ id: 'c', freeX: 800, freeY: 0, links: ['missing'] });

describe('LinkLines', () => {
  it('draws one solid hairline per related pair, centre to centre, and none to a note not on the canvas', () => {
    const { container } = render(<LinkLines notes={[a, b, c]} pendingFor={() => undefined} />);
    const lines = container.querySelectorAll('line');
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.getAttribute('data-link')).toBe('a:b');
    expect(line).not.toHaveAttribute('data-pending');
    expect(line.getAttribute('x1')).toBe(String(NOTE_CARD_WIDTH / 2));
    expect(line.getAttribute('y1')).toBe(String(NOTE_CARD_HEIGHT / 2));
    expect(line.getAttribute('x2')).toBe(String(400 + NOTE_CARD_WIDTH / 2));
    expect(line.getAttribute('y2')).toBe(String(300 + NOTE_CARD_HEIGHT / 2));
  });

  it('draws a dashed line for each ticked proposed link while the proposal is pending', () => {
    const fresh = makeNote({ id: 'n', freeX: 100, freeY: 100, links: [] });
    const mark = makeSuggestionMark({ fields: ['links'], links: [1] });
    mark.suggestion!.fields.links = {
      items: [
        { noteId: 'a', title: 'A', reason: 'r' },
        { noteId: 'b', title: 'B', reason: 'r' },
      ],
      reason: 'r',
    };
    const pendingFor = (id: string): PendingProps | undefined =>
      id === 'n' ? ({ mark } as unknown as PendingProps) : undefined;
    const { container } = render(<LinkLines notes={[a, b, fresh]} pendingFor={pendingFor} />);
    const pending = container.querySelectorAll('line[data-pending]');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.getAttribute('data-link')).toBe('b:n');
  });
});
```

Run: FAIL.

- [ ] **Step 2: The layer**

`LinkLines.tsx`:

```tsx
import { useMemo } from 'react';
import {
  FREE_CANVAS_HEIGHT,
  FREE_CANVAS_WIDTH,
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  type NoteDto,
} from '@wally/shared';
import type { PendingProps } from '../Suggestions/pendingProps';

export function cardCentre(note: Pick<NoteDto, 'freeX' | 'freeY'>) {
  return { x: note.freeX + NOTE_CARD_WIDTH / 2, y: note.freeY + NOTE_CARD_HEIGHT / 2 };
}

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * The hairlines between related cards on the free canvas (0005-wallybot-inline.md §3.4, plan L5):
 * solid for a kept link, dashed for a link a pending proposal still offers; the note border
 * colour, 1 px, each pair once, under the cards. Positions come from the notes, so a drop
 * moves the line with the card. Zone bands and the list draw none.
 */
export function LinkLines({
  notes,
  pendingFor,
}: {
  notes: readonly NoteDto[];
  pendingFor?: (noteId: string) => PendingProps | undefined;
}) {
  const lines = useMemo(() => {
    const byId = new Map(notes.map((n) => [n.id, n]));
    const out = new Map<string, { from: NoteDto; to: NoteDto; pending: boolean }>();
    for (const note of notes) {
      for (const id of note.links) {
        const target = byId.get(id);
        if (!target) continue;
        const key = pairKey(note.id, id);
        if (!out.has(key)) out.set(key, { from: note, to: target, pending: false });
      }
      const mark = pendingFor?.(note.id)?.mark;
      if (
        mark?.phase !== 'pending' ||
        !mark.fields.includes('links') ||
        !mark.suggestion?.fields.links
      )
        continue;
      mark.suggestion.fields.links.items.forEach((item, index) => {
        if (!mark.links.includes(index)) return;
        const target = byId.get(item.noteId);
        if (!target) return;
        const key = pairKey(note.id, item.noteId);
        if (!out.has(key)) out.set(key, { from: note, to: target, pending: true });
      });
    }
    return [...out.entries()];
  }, [notes, pendingFor]);
  if (lines.length === 0) return null;
  return (
    <svg
      data-link-lines
      aria-hidden
      width={FREE_CANVAS_WIDTH}
      height={FREE_CANVAS_HEIGHT}
      className="pointer-events-none absolute inset-0"
    >
      {lines.map(([key, { from, to, pending }]) => {
        const a = cardCentre(from);
        const b = cardCentre(to);
        return (
          <line
            key={key}
            data-link={key}
            data-pending={pending || undefined}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--note-border)"
            strokeWidth={1}
            strokeDasharray={pending ? '4 4' : undefined}
          />
        );
      })}
    </svg>
  );
}
```

`WallCanvas.tsx`: render `<LinkLines notes={notes} pendingFor={pendingFor} />` as the first child of the sized canvas `div` (before the cards, so the cards paint over the lines). `WallCanvas.test.tsx`: a case with two related notes asserts `[data-link-lines] line` has length 1. Run both files: PASS.

- [ ] **Step 3: Checks and commit**

Lint, typecheck, format check, the whole web suite; the brand guard (no colour on the line: the stroke is the border token).

```bash
git add apps/web/src/features/board/WallView/LinkLines.tsx apps/web/src/features/board/WallView/LinkLines.test.tsx apps/web/src/features/board/WallView/WallCanvas.tsx apps/web/src/features/board/WallView/WallCanvas.test.tsx
git -c core.hooksPath=/dev/null commit -m "feat(web): a hairline joins related cards on the free canvas, dashed while proposed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs and the E2E flow

**Files:**

- Modify: `docs/rfcs/0005-wallybot-inline.md` (status line; §3.4 names the free canvas)
- Modify: `docs/BRAND.md` ("## AI" paragraph names links among what the fill-in proposes)
- Modify: `docs/rfcs/0003-wally-agent.md` (§3.3 `update_note` row: "(fields, tags, links)")
- Create: `apps/web/e2e/note-links.spec.ts`
- Modify: `.github/workflows/ci.yml` (`MIN_EXECUTED` + 1 if the new spec runs on the desktop project)

- [ ] **Step 1: Docs**

`0005-wallybot-inline.md` **Status**: append `; links between notes (slice 3's R1) started 2026-10-18: a stored relation, proposed by Wallybot and kept one by one, drawn as a hairline on the free canvas.` In §3.4's last bullet, "drawn on the wall as a hairline" becomes "drawn on the free canvas as a hairline (the zone bands and the list show the relation in the note panel)".

`BRAND.md` "## AI" paragraph: "proposes a due date, a priority, a person, subtasks or a reference" becomes "proposes a due date, a priority, a person, subtasks, a reference or links to related notes".

`0003-wally-agent.md` §3.3 `update_note` row, "Command or query" cell: `note.update`, without assignment (fields, tags, links). Run `pnpm format:check`; `pnpm format` if the table moved.

- [ ] **Step 2: E2E**

`apps/web/e2e/note-links.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { captureNote, hasE2eCredentials, signIn } from './support';

test('a note is linked to another from the panel and the other lists it back', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  const stamp = Date.now();
  const first = `E2E link target ${stamp}`;
  const second = `E2E link source ${stamp}`;
  await captureNote(page, first);
  const panel = await captureNote(page, second, { open: true });

  await panel.getByRole('button', { name: 'Notiz verknüpfen…' }).click();
  await page.getByLabel('Notiz suchen').fill(first);
  await page.getByRole('option', { name: first }).click();
  const row = panel.getByRole('button', { name: first });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('title', `Verknüpft mit ${first}`);

  // The other note lists the link back, read-only.
  await row.click();
  await expect(panel.getByRole('button', { name: second })).toHaveAttribute(
    'title',
    `Verknüpft von ${second}`,
  );
  await expect(
    panel.getByRole('button', { name: `Verknüpfung zu ${second} entfernen` }),
  ).toHaveCount(0);
});
```

(cmdk renders items with `role="option"`; confirm in `components/ui/command.tsx` and adjust the role if it differs. `MIN_EXECUTED` in `ci.yml` counts executed tests: raise it by one.) Run `cd apps/web && pnpm exec playwright test --list`.

- [ ] **Step 3: Commit**

```bash
git add docs/rfcs/0005-wallybot-inline.md docs/BRAND.md docs/rfcs/0003-wally-agent.md apps/web/e2e/note-links.spec.ts .github/workflows/ci.yml
git -c core.hooksPath=/dev/null commit -m "docs: links between notes; an E2E flow links two notes from the panel

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** §3.4: links to related notes proposed after commit (T3), shown in the review's "Added by Wallybot" with a checkbox per row (T5), the card following the ticks (T5), kept and undone as one record (T4), the hairline while pending that stays only if kept (T7, L5). §4: the record binds to the note's revision and runs under operation ids through `update_note` (T4); the model's input carries the board's other notes as compact rows (T3). §7: nothing overwritten (links only on a note without any, L3). WALLY_AGENT §3.3: no new operation (L2). BRAND rule 3: the line is the border colour, no colour; rule 4: undo in one step (T4, T5); rule 5: no toast.
- **Placeholder scan.** Every step carries code or an exact edit; the two spots where a name must be read from the code (`props(mark)` helper, `RemoveButton` props, cmdk's role) say which file to read.
- **Type consistency.** `fields.links.items[]` carries `title` in the DTO (T2) but not in the stored doc (T2) nor the model reply (T3); `mark.links` (T2, T5) are indexes like `mark.subtasks`; `decision.links` (T2) is what `keepBody` (T5) sends and `decideSuggestion` (T4) reads; `applied.linkIds` (T2) is what the undo removes (T4); `onSetLink` (T5) is wired in `usePendingFor` and used by the card, the review and the lines' test; `relatedNotes` (T6) is used by `RelatedNotes`; `note.links` (T1) is read by `proposedValues` (T5), `relatedNotes` (T6) and `LinkLines` (T7).
- **Review Focus.** 1 → T1 route cases; 2 → T4 case; 3 → T3 route and schema cases, T2's `toDto` (a deleted target drops: covered by T3's `toDto` path, add an assertion there if the implementer finds it missing); 4 → T6 section tests; 5 → T7 tests and T5's count.
- **Deferred, for the PR:** cleaning dangling ids when a note is deleted (L7); lines in the zone bands and the list (L5); linking from the card without the panel; a link's own reason shown after the keep.
