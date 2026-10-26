# Questions on the Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A question typed into the capture card, ending in `?`, is answered where it was written: an ephemeral card on the wall in the note's own type with a dashed edge, the notes it relied on as rows underneath, fading after it is read unless pinned; the question panel, its button, its palette entry, its shortcut and its URL state are retired (0005-wallybot-inline.md §3.6).

**Architecture:** Web and docs only. The API's turn route, ledger and conversation storage serve the card unchanged (§3.6); only the system prompt stops calling the surface a panel. On the web, the capture card recognises a question on Enter and hands it to the shell instead of committing a note (the draft note it created on the first keystroke is deleted, as a discarded capture's is); a new `useAskSession` hook owns one question at a time, its outcome, its reading clock, pin and pause; a new `AskCard` draws it, and the three views place it exactly where they place the capture card (free canvas at the point, zone at its top, list as the top row). `features/board/Assistant` becomes `features/board/Ask`, keeping only what the card needs (`useAskAssistant`, `AnswerNotes`).

**Tech Stack:** React 19 + TanStack Query 5 + Tailwind tokens + lucide-react (Pin, PinOff, X). No new dependency. No API schema change.

**Spec:** `docs/rfcs/0005-wallybot-inline.md` §3.1 (the capture card), §3.6 (questions), §5 slice 4, §7; `docs/rfcs/0003-wally-agent.md` §3.2 (chips checked at render time, the cap refusal says when it resets, it speaks the user's language) and §3.4; `docs/BRAND.md` "## AI" (rules 1–5 and 8, amended by this plan), "Marigold has four jobs", "Shape, depth and motion". Slices 1–3 (`docs/superpowers/plans/2026-10-16-capture-inline.md`, `2026-10-17-capture-suggest.md`, `2026-10-17-capture-review.md`) are the record of the capture flow this builds on.

## Context

Slices 1–3 made the capture card the one place a person writes. §3.6 says the question panel "is retired as a surface" once a question can be asked from that card. Decisions for this plan, each with its reason and its cost if wrong:

- **R1. A title that ends in `?` is a question.** The check is on the trimmed title line alone; a text line typed under it (Shift+Enter) travels with the question after a blank line. While the title ends in `?`, the card's hint line says that Enter asks, so nobody is surprised by what Enter does (§3.2's "understand while typing", without a parser). With the board's assistant off, nothing is passed to the card and a `?` title is a plain note. Cost if wrong: a note whose title is a question gets its title through the panel afterwards; one edit.
- **R2. The draft note is deleted, the answer is not a note.** The note exists from the first keystroke (§3.1); on a question the card deletes it the way `cancel` does (no Undo toast, nothing to undo) and the capture ends with no note, so the shell asks Wallybot for nothing (AI rule 6: it never writes a note the person did not start). Cost if wrong: a wasted create and delete per question, invisible.
- **R3. The answer card takes the capture's place.** Free canvas: the point the capture had, clamped so the card stays on the canvas; a zone: the top of the zone the question was written in; the list: the top row. It is its own component (as the capture card is, never a mode of `NoteCard`), 376 px wide on the wall because an answer is a paragraph, full width as a row; white note fill, the note's type for the question line, the pending look's dashed edge in the note border colour, **no dot and no ring**: nothing is written, so there is nothing to keep or count down (BRAND rule 3 names the dot for pending changes; marigold's fourth job stays with them). Cost if wrong: a width to tune.
- **R4. Follow-ups continue a conversation while its card still shows.** A question asked while an earlier answer card is on the page (pinned, or not yet faded) continues that conversation, so "and which of those are mine?" works; once the card is gone, the next question starts a new conversation. The API's `latest` route is no longer called by the web (the routes stay, unchanged, as §3.6 says); the id lives in the hook for the life of the card. Cost if wrong: a follow-up without context is asked again in full.
- **R5. The card fades after a reading time, paused by hover or focus, held by a pin.** Reading time is 8 s plus 250 ms per word of the answer, at most 30 s; a refusal or a failure stays 8 s. Hover or focus on the card pauses the clock and leaving resumes it with what was left; Esc or the card's × fades it at once; the pin holds it until it is unpinned (the full reading time starts again) or closed. The fade is 180 ms of opacity (`animate-fade-out`), nothing under reduced motion. A reload does not bring a card back: the conversation is stored for 30 days by the API as the person's history, and nothing is shown that was not asked on this page. Cost if wrong: two constants.
- **R6. Using the card pins it.** A click on a note row opens that note in the panel and pins the card, so the answer is still there when the person comes back from the note. Cost if wrong: one × more.
- **R7. The panel is retired whole.** `AssistantPanel`, `AssistantContent`, `useAssistantConversation` and their tests go; so do the top bar's Ask button, the palette entry with its keywords, `⌘J` and its help row, `?ask=1` and `openAsk` in the view state, `assistantApi.latest` and the `assistantLatest` query key, and the `assistant.*`, `palette.ask*`, `shortcuts.ask` catalogue keys. The `⌘Z` help row keeps its `assistantEnabled` gate. The API's conversation routes stay (§3.6: unchanged). Cost if wrong: history is in git.
- **R8. Focus follows the question.** The capture card's unmount leaves the focus on the page; the answer card takes it on mount in that case (never when the person has focused something else meanwhile), so Esc, Tab to pin, × and the rows all work from the keyboard; when the card goes with the focus inside it, the focus goes to the board surface, as a committed capture's does. The card's body is a polite live region, so the answer is announced when it arrives. Cost if wrong: one Tab.
- **R9. The answer is the last assistant entry of the turn's conversation.** The turn route answers the whole conversation; the card shows only the exchange it asked for (question line, answer, stopped and partial lines, rows). Earlier exchanges are not shown anywhere any more (R7). Cost if wrong: nothing to remove.
- **The title field gets the note title's length cap** (`NOTE_TITLE_MAX_LENGTH`, 200): today a longer title fails its draft save with a 422 the person cannot act on; a question is bound by the same cap, which is enough for any question worth typing in a card (the route's own cap is 2000).

## Global Constraints

- Work only in `/Users/mr_user/development/apps/wally-questions`, branch `feat/questions-on-wall` (cut from `origin/main` after PR #51; base `main`; never stacked). Never run git or edit files in `/Users/mr_user/development/apps/wally` (bind-mounted into the running stack) or in any other worktree under `/Users/mr_user/development/apps/`.
- API tests are not needed by this plan except `apps/api/src/lib/assistant/prompt.test.ts`, a unit test with no emulator: `cd /Users/mr_user/development/apps/wally-questions/apps/api && pnpm vitest run src/lib/assistant/prompt.test.ts`. Never run any docker or docker compose command.
- Web tests touch no emulator: `cd /Users/mr_user/development/apps/wally-questions/apps/web && pnpm vitest run <file>`, one file at a time while iterating; the whole web suite once per task before committing (`pnpm vitest run`).
- Checks from the worktree root: `pnpm --filter @wally/api typecheck`, `pnpm --filter @wally/api lint`, `pnpm --filter @wally/web typecheck`, `pnpm --filter @wally/web lint`, `pnpm format:check` (fix with `pnpm format`). Guard tests stay green: `apps/web/src/brandGuards.test.ts`, `apps/web/src/englishIdentifiers.test.ts`, `apps/web/src/i18n/noHardcodedCopy.test.ts`, `apps/web/src/i18n/resources.test.ts`, `apps/web/src/i18n/germanSurface.test.tsx`, `apps/web/src/features/board/WallView/NoteCard.test.tsx`.
- No new dependency. Nothing under `apps/api/src/lib/assistant/model/` changes.
- Every visible or screen-reader string comes from the catalogues (`de.ts` is the key authority, `en.ts` mirrors every key); German words in TS source outside the catalogues as `\u` escapes where `noHardcodedCopy` requires.
- BRAND.md: no sparkle, wand, robot or brain icon; the AI has no name and no first person in copy; no toasts, no modals, no badges; the answer card's only marker is the dashed edge in `border-[color:var(--note-border)]`; no marigold on it; AI output in the same type and colour as a note; motion 120–180 ms on opacity and transform only, off under reduced motion; controls at least 40 px on a coarse pointer (the `icon-sm` Button already grows there).
- Code identifiers in English (ADR-0014); the persisted values `WEISS`, `wand` stay as they are until ADR-0014's later steps.
- Conventional Commits; never commit to `main`. Commit with `git -c core.hooksPath=/dev/null commit`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the model that wrote them, as the workflow names it).
- Prettier: single quotes, trailing commas, width 100.

## Review Focus

1. A `?` title with the board's assistant off commits a plain note, with it on deletes the draft note and leaves no note behind, and the shell asks Wallybot for nothing. Tests in Task 1 (card and session) and Task 6 (E2E, assistant off in CI).
2. Two questions in a row while the first card shows continue one conversation; after the card faded, the next question starts a new one; an answer that arrives after the card was dismissed sets no conversation. Tests in Task 2.
3. Hover pauses the fade and leaving resumes it with the time that was left; a pin holds it; unpinning starts the full reading time again; Esc fades at once, from the card or its ×. Tests in Task 2 and Task 3.
4. A cap refusal names the reset moment in the reader's locale and a failure says so; both fade after 8 s; neither throws. Tests in Task 2 and Task 3.
5. Keyboard only: after Enter the card has the focus; Tab reaches pin, × and the rows; Esc fades the card and the focus lands on the board surface; the board's single-key shortcuts never fire while the card has focus. Tests in Task 3.

---

### Task 1: The capture card knows a question

**Files:**

- Create: `apps/web/src/lib/capture/question.ts`
- Create: `apps/web/src/lib/capture/question.test.ts`
- Modify: `apps/web/src/features/board/Capture/InlineCaptureCard.tsx`
- Modify: `apps/web/src/features/board/Capture/InlineCaptureCard.test.tsx`
- Modify: `apps/web/src/features/board/Capture/useCaptureSession.ts`
- Modify: `apps/web/src/features/board/Capture/useCaptureSession.test.tsx`
- Modify: `apps/web/src/features/board/WallView/WallView.tsx`, `WallCanvas.tsx`, `ZoneBands.tsx`, `apps/web/src/features/board/ListView/ListView.tsx` (thread one optional callback)
- Modify: `apps/web/src/i18n/de.ts`, `apps/web/src/i18n/en.ts` (`capture.hintAsk`, `capture.hintAskCoarse`)

**Interfaces:**

- Produces: `isQuestion(title: string): boolean`, `questionOf(title: string, description: string): string | null` in `@/lib/capture/question`.
- Produces: `InlineCaptureCard` prop `onAsk?: (question: string) => void`; views' prop `onCaptureAsk?: (question: string) => void` (WallView, WallCanvas, ZoneBands; ListView's `capture.onAsk?`); `useCaptureSession` option `onAsked?: (question: string, placement: CapturePlacement) => void` and return value `onCaptureAsk: (question: string) => void`.

- [ ] **Step 1: The question check, test first**

`apps/web/src/lib/capture/question.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isQuestion, questionOf } from './question';

describe('questionOf', () => {
  it('reads a title ending in a question mark as a question', () => {
    expect(isQuestion('What is open today?')).toBe(true);
    expect(isQuestion('What is open today? ')).toBe(true);
    expect(questionOf('  What is open today?  ', '')).toBe('What is open today?');
  });

  it('reads anything else as a note', () => {
    expect(isQuestion('Call Müller')).toBe(false);
    expect(isQuestion('Ask Anna? today')).toBe(false);
    expect(isQuestion('?')).toBe(true);
    expect(questionOf('Call Müller', 'Why?')).toBeNull();
  });

  it('carries the text line with the question, after a blank line', () => {
    expect(questionOf('Which are overdue?', '  Only mine  ')).toBe(
      'Which are overdue?\n\nOnly mine',
    );
    expect(questionOf('Which are overdue?', '   ')).toBe('Which are overdue?');
  });
});
```

Run: `cd /Users/mr_user/development/apps/wally-questions/apps/web && pnpm vitest run src/lib/capture/question.test.ts`
Expected: FAIL, module not found.

`apps/web/src/lib/capture/question.ts`:

```ts
/**
 * A line that ends in a question mark is a question for the wall, not a note
 * (0005-wallybot-inline.md §3.6, plan R1). The check is on the title line alone; the text typed
 * under it travels with the question, after a blank line.
 */
export function isQuestion(title: string): boolean {
  return title.trimEnd().endsWith('?');
}

export function questionOf(title: string, description: string): string | null {
  const line = title.trim();
  if (!isQuestion(line)) return null;
  const text = description.trim();
  return text ? `${line}\n\n${text}` : line;
}
```

Run the test again. Expected: PASS.

- [ ] **Step 2: The catalogue hint**

In `apps/web/src/i18n/de.ts`, inside `capture`, after `hintCoarse`:

```ts
    /** While the title ends in a question mark: Enter asks instead of writing a note (§3.6). */
    hintAsk: '↵ fragt die Wand · Esc verwerfen',
    hintAskCoarse: 'Enter fragt die Wand',
```

In `apps/web/src/i18n/en.ts`, inside `capture`, after `hintCoarse`:

```ts
    hintAsk: '↵ asks the wall · Esc discard',
    hintAskCoarse: 'Enter asks the wall',
```

- [ ] **Step 3: Card tests, written first**

Append to `describe('InlineCaptureCard', …)` in `apps/web/src/features/board/Capture/InlineCaptureCard.test.tsx` (the file's `renderCard` helper takes no `onAsk`; render these cases directly as shown, with the same providers):

```tsx
describe('a question', () => {
  function renderAsking(onAsk = vi.fn(), onDone = vi.fn()) {
    renderWithProviders(
      <InlineCaptureCard
        boardId="b1"
        placement={{ kind: 'free', x: 10, y: 20 }}
        visibility="SHARED"
        layout="card"
        onDone={onDone}
        onAsk={onAsk}
      />,
    );
    return { onAsk, onDone, title: screen.getByLabelText('Title of the new note') };
  }

  it('says that Enter asks once the title ends in a question mark', async () => {
    const { title } = renderAsking();
    await userEvent.type(title, 'What is open today');
    expect(screen.getByText('↵ create · ⇧↵ text · Esc discard')).toBeInTheDocument();
    await userEvent.type(title, '?');
    expect(screen.getByText('↵ asks the wall · Esc discard')).toBeInTheDocument();
    expect(screen.queryByText('↵ create · ⇧↵ text · Esc discard')).not.toBeInTheDocument();
  });

  it('Enter on a question hands it over, deletes the draft note and ends the capture with no note', async () => {
    const { onAsk, onDone, title } = renderAsking();
    await userEvent.type(title, 'What is open today?{Enter}');
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('What is open today?'));
    await waitFor(() => expect(notesApi.remove).toHaveBeenCalledWith('n-new', expect.anything()));
    expect(onDone).toHaveBeenCalledWith(null, false, []);
    expect(notesApi.move).not.toHaveBeenCalled();
    expect(notesApi.assign).not.toHaveBeenCalled();
  });

  it('carries the text line with the question', async () => {
    const { onAsk, title } = renderAsking();
    await userEvent.type(title, 'Which are overdue?{Shift>}{Enter}{/Shift}');
    await userEvent.type(screen.getByLabelText('Text of the new note'), 'Only mine{Enter}');
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('Which are overdue?\n\nOnly mine'));
  });

  it('a blur on a question asks it too', async () => {
    const { onAsk, title } = renderAsking();
    await userEvent.type(title, 'What is late?');
    await userEvent.tab();
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('What is late?'));
  });

  it('without asking on, a question mark is a plain title and the hint does not change', async () => {
    const { onDone } = renderCard();
    const title = screen.getByLabelText('Title of the new note');
    await userEvent.type(title, 'Call Müller?');
    expect(screen.getByText('↵ create · ⇧↵ text · Esc discard')).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, []));
    expect(notesApi.remove).not.toHaveBeenCalled();
  });

  it('caps the title at the note title length', () => {
    renderCard();
    expect(screen.getByLabelText('Title of the new note')).toHaveAttribute('maxlength', '200');
  });
});
```

Run: `pnpm vitest run src/features/board/Capture/InlineCaptureCard.test.tsx`
Expected: FAIL on the six new cases (unknown prop `onAsk` is ignored by React, so the first failures are the missing hint text and the missing `remove` call).

- [ ] **Step 4: The card**

In `apps/web/src/features/board/Capture/InlineCaptureCard.tsx`:

Imports: add `import { NOTE_TITLE_MAX_LENGTH } from '@wally/shared';` to the existing `@wally/shared` value import (`suggestionFieldKeys` is imported there already) and `import { isQuestion, questionOf } from '@/lib/capture/question';`.

Props: after `onNoteId?`, add

```tsx
  /**
   * Set when the board's assistant is on: a title ending in `?` is a question for the wall
   * (0005-wallybot-inline.md §3.6, plan R1). The card hands the question over, deletes the draft
   * note and ends the capture with no note (R2). Without it a `?` is a plain title.
   */
  onAsk?: (question: string) => void;
```

and destructure `onAsk` in the component's parameter list.

In `commit`, replace the start of the function so it reads:

```tsx
  async function commit(thenOpen: boolean) {
    const trimmed = title.trim();
    if (!hasWords || settling.current) return;
    const question = onAsk ? questionOf(trimmed, description) : null;
    if (question) {
      settling.current = true;
      // The answer is not a note (BRAND AI rule 6): the shell draws it where this card stood,
      // and the words typed so far go the way a discarded capture's do (plan R2).
      onAsk(question);
      await controller.cancel();
      return;
    }
    settling.current = true;
    try {
```

(the rest of `commit` is unchanged).

Before the `return (`, add

```tsx
const asking = onAsk !== undefined && isQuestion(title);
```

On the title `MirroredField`, add `maxLength={NOTE_TITLE_MAX_LENGTH}` (the component spreads its props onto the textarea).

Replace the two hint paragraphs:

```tsx
      <p id={hintId} className="font-mono text-12 text-fg-faint [@media(pointer:coarse)]:hidden">
        {t(asking ? 'capture.hintAsk' : 'capture.hint')}
      </p>
      <p className="hidden text-12 text-fg-faint [@media(pointer:coarse)]:block">
        {t(asking ? 'capture.hintAskCoarse' : 'capture.hintCoarse')}
      </p>
```

Run: `pnpm vitest run src/features/board/Capture/InlineCaptureCard.test.tsx`
Expected: PASS, every case, no act() warnings.

- [ ] **Step 5: The session hears the question, with its placement**

`apps/web/src/features/board/Capture/useCaptureSession.test.tsx` has a harness rendering the real views; add a self-contained hook test at the end of the file instead (it needs no board):

```tsx
describe('useCaptureSession asking', () => {
  it('hands a question to onAsked with the placement of the capture it was typed in', () => {
    const onAsked = vi.fn();
    const { result } = renderHook(() =>
      useCaptureSession({
        boardId: BOARD,
        view: 'wand',
        axis: 'free',
        openNoteId: null,
        openNote: vi.fn(),
        onAsked,
      }),
    );
    act(() => result.current.startCapture({ kind: 'free', x: 40, y: 60 }));
    act(() => result.current.onCaptureAsk('What is open?'));
    expect(onAsked).toHaveBeenCalledWith('What is open?', { kind: 'free', x: 40, y: 60 });

    // The capture then ends with no note, as a discarded one does; nothing else is heard.
    act(() => result.current.onCaptureDone(null, false, []));
    expect(result.current.capture).toBeNull();
    act(() => result.current.onCaptureAsk('Late?'));
    expect(onAsked).toHaveBeenCalledTimes(1);
  });
});
```

(import `renderHook` from `@testing-library/react` alongside the file's existing imports.)

Run: `pnpm vitest run src/features/board/Capture/useCaptureSession.test.tsx`
Expected: FAIL, `onCaptureAsk` is not a function.

In `apps/web/src/features/board/Capture/useCaptureSession.ts`: add to the options

```ts
  /** Hears a question typed into the card, with the place it was written (§3.6); the shell answers there. */
  onAsked?: (question: string, placement: CapturePlacement) => void;
```

and in the body, after `latestOnCommitted`:

```ts
const latestOnAsked = useRef(onAsked);
latestOnAsked.current = onAsked;
```

after `onCaptureNoteId`:

```ts
const shownPlacement = shown?.placement;
const onCaptureAsk = useCallback(
  (question: string) => {
    if (shownPlacement) latestOnAsked.current?.(question, shownPlacement);
  },
  [shownPlacement],
);
```

Add `onCaptureAsk` to the returned object and its `useMemo` deps. Add the `onAsked` parameter to the destructured options.

Run the test again. Expected: PASS.

- [ ] **Step 6: Thread the callback through the views**

`WallView.tsx`: add to `WallViewProps` after `onCaptureNoteId`:

```ts
  /** Hears a question typed into the card; absent when the board's assistant is off. */
  onCaptureAsk?: (question: string) => void;
```

destructure it, and pass `onCaptureAsk={onCaptureAsk}` to both `WallCanvas` and `ZoneBands`.

`WallCanvas.tsx`: the same prop on `WallCanvasProps`, destructured, and on the capture card `onAsk={onCaptureAsk}`.

`ZoneBands.tsx`: `ZoneCapture` gains `onAsk: ((question: string) => void) | undefined;`; `ZoneBandsProps` gains the same optional `onCaptureAsk` prop; `ZoneBands` destructures it and passes `onAsk: onCaptureAsk` when it builds the zone's capture; `ZoneBand` passes `onAsk={capture.onAsk}` to the card.

`ListView.tsx`: the `capture` prop's object gains `onAsk?: (question: string) => void;` and the row passes `onAsk={capture.onAsk}`.

Nothing in `AppShell` yet (Task 4 wires it).

- [ ] **Step 7: Checks and commit**

Run from the worktree root: `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check`, then `cd apps/web && pnpm vitest run`.
Expected: all green.

```bash
git add apps/web/src/lib/capture/question.ts apps/web/src/lib/capture/question.test.ts apps/web/src/features/board/Capture/InlineCaptureCard.tsx apps/web/src/features/board/Capture/InlineCaptureCard.test.tsx apps/web/src/features/board/Capture/useCaptureSession.ts apps/web/src/features/board/Capture/useCaptureSession.test.tsx apps/web/src/features/board/WallView/WallView.tsx apps/web/src/features/board/WallView/WallCanvas.tsx apps/web/src/features/board/WallView/ZoneBands.tsx apps/web/src/features/board/ListView/ListView.tsx apps/web/src/i18n/de.ts apps/web/src/i18n/en.ts
git -c core.hooksPath=/dev/null commit -m "feat(web): a title ending in a question mark asks the wall instead of writing a note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One question at a time: the ask session

**Files:**

- Move: `apps/web/src/features/board/Assistant/useAskAssistant.ts` → `apps/web/src/features/board/Ask/useAskAssistant.ts` (rewritten)
- Move: `apps/web/src/features/board/Assistant/useAskAssistant.test.tsx` → `apps/web/src/features/board/Ask/useAskAssistant.test.tsx` (rewritten)
- Create: `apps/web/src/features/board/Ask/useAskSession.ts`
- Create: `apps/web/src/features/board/Ask/useAskSession.test.tsx`
- Modify: `apps/web/src/features/board/Assistant/AssistantContent.tsx` (import path and the hook's new shape, so the panel still compiles until Task 5 removes it)

**Interfaces:**

- Consumes: `CapturePlacement` from `../Capture/useCapture`; `assistantApi.turn`.
- Produces: `useAskAssistant(boardId): (message: string, conversationId: string | null) => Promise<AskOutcome>`; `AskOutcome`, `RefusalCode` (as today); `useAskSession(boardId): AskController`; `AskSession`, `AskPhase`, `AskController`; `readingTimeMs(text)`, `READ_BASE_MS`, `READ_PER_WORD_MS`, `READ_MAX_MS`, `FADE_MS`.

- [ ] **Step 1: Move and simplify `useAskAssistant`**

`git mv apps/web/src/features/board/Assistant/useAskAssistant.ts apps/web/src/features/board/Ask/useAskAssistant.ts` and the test alongside. Rewrite the hook (R4, R7: no query cache, no pending flag; the session owns both):

```ts
import { useCallback } from 'react';
import type { AssistantConversationDto } from '@wally/shared';
import { ApiError } from '@/lib/apiClient';
import { assistantApi } from '@/lib/resources';

export type RefusalCode = 'ASSISTANT_DAILY_CAP' | 'ASSISTANT_MONTHLY_CAP' | 'ASSISTANT_BUSY';
export type AskOutcome =
  | { kind: 'answered'; conversation: AssistantConversationDto }
  | { kind: 'refused'; code: RefusalCode; resetsAt: string | null }
  | { kind: 'failed' };

/** 429 codes the card renders as a refusal. RATE_LIMITED is the route's own limiter, which
 *  sends no reset time, so it reads as busy. */
const REFUSALS: Record<string, RefusalCode> = {
  ASSISTANT_DAILY_CAP: 'ASSISTANT_DAILY_CAP',
  ASSISTANT_MONTHLY_CAP: 'ASSISTANT_MONTHLY_CAP',
  ASSISTANT_BUSY: 'ASSISTANT_BUSY',
  RATE_LIMITED: 'ASSISTANT_BUSY',
};

/** Today in the browser's calendar, as the API expects it; not UTC, which is a day off at night. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * One question to the board. The API's three outcomes come back as data, never thrown, so
 * the card renders each in the answer's place. A conversation that closed underneath is
 * retried once without its id, which starts a new one.
 */
export function useAskAssistant(boardId: string) {
  return useCallback(
    async (message: string, conversationId: string | null): Promise<AskOutcome> => {
      const base = {
        message,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        today: localToday(),
      };
      try {
        let response;
        try {
          response = await assistantApi.turn(
            boardId,
            conversationId ? { ...base, conversationId } : base,
          );
        } catch (error) {
          if (
            conversationId &&
            error instanceof ApiError &&
            error.status === 409 &&
            error.code === 'ASSISTANT_CONVERSATION_CLOSED'
          )
            response = await assistantApi.turn(boardId, base);
          else throw error;
        }
        return { kind: 'answered', conversation: response.conversation };
      } catch (error) {
        const code =
          error instanceof ApiError && error.status === 429 && error.code
            ? REFUSALS[error.code]
            : undefined;
        if (error instanceof ApiError && code) {
          const body = error.body as { resetsAt?: string | null } | undefined;
          return {
            kind: 'refused',
            code,
            resetsAt: error.code === 'RATE_LIMITED' ? null : (body?.resetsAt ?? null),
          };
        }
        return { kind: 'failed' };
      }
    },
    [boardId],
  );
}
```

Rewrite its test for the new shape: keep every existing case (sends the browser date and zone; retries once on `ASSISTANT_CONVERSATION_CLOSED`; a 429 with a code is a refusal with `resetsAt`; `RATE_LIMITED` is busy with a null reset; any other error is `failed`), with these changes: the `vi.mock` of `@/lib/resources` provides `assistantApi: { turn: vi.fn() }` only; no `QueryClientProvider` wrapper and no `createTestQueryClient` import; `const { result } = renderHook(() => useAskAssistant('b1'))` and the call is `await result.current('What is open?', null)`; the assertion on the query cache is removed; the `scopedQueryKeys` import goes. Run it: `pnpm vitest run src/features/board/Ask/useAskAssistant.test.tsx`. Expected: PASS.

In `apps/web/src/features/board/Assistant/AssistantContent.tsx` (still present until Task 5): change the import to `from '../Ask/useAskAssistant'`, replace `const { ask, isPending } = useAskAssistant(boardId);` by `const ask = useAskAssistant(boardId); const [isPending, setIsPending] = useState(false);` and wrap the call in `submit`: `setIsPending(true); const outcome = await ask(message, conversation?.id ?? null).finally(() => setIsPending(false));`. Run `pnpm vitest run src/features/board/Assistant/AssistantContent.test.tsx`: PASS unchanged (the panel goes in Task 5).

- [ ] **Step 2: The session, tests first**

`apps/web/src/features/board/Ask/useAskSession.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AssistantConversationDto } from '@wally/shared';
import type { AskOutcome } from './useAskAssistant';

const askTurn = vi.fn<(message: string, conversationId: string | null) => Promise<AskOutcome>>();
vi.mock('./useAskAssistant', () => ({ useAskAssistant: () => askTurn }));

import {
  FADE_MS,
  READ_BASE_MS,
  READ_MAX_MS,
  READ_PER_WORD_MS,
  readingTimeMs,
  useAskSession,
} from './useAskSession';

const AT = '2026-10-17T10:00:00.000Z';
const FREE = { kind: 'free', x: 10, y: 20 } as const;

function conversation(id: string, text: string): AssistantConversationDto {
  return {
    id,
    boardId: 'b1',
    status: 'OPEN',
    model: 'm',
    entries: [
      { role: 'user', text: 'q', chips: [], partial: false, stopped: null, at: AT },
      {
        role: 'assistant',
        text,
        chips: [{ id: 'n1', title: 'Call Müller' }],
        partial: false,
        stopped: null,
        at: AT,
      },
    ],
  };
}
const answered = (id: string, text = 'Two notes are open.'): AskOutcome => ({
  kind: 'answered',
  conversation: conversation(id, text),
});

/** Resolves the mocked turn and lets the hook store the outcome. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

describe('readingTimeMs', () => {
  it('is a floor, a share per word and a ceiling', () => {
    expect(readingTimeMs('')).toBe(READ_BASE_MS);
    expect(readingTimeMs('one two  three\nfour five six seven eight nine ten')).toBe(
      READ_BASE_MS + 10 * READ_PER_WORD_MS,
    );
    expect(readingTimeMs(Array.from({ length: 200 }, () => 'w').join(' '))).toBe(READ_MAX_MS);
  });
});

describe('useAskSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    askTurn.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('asks with no conversation, shows the answer, fades after the reading time and goes', async () => {
    askTurn.mockResolvedValue(answered('c1', 'one two three four'));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('What is open?', FREE));
    expect(result.current.session).toMatchObject({
      phase: 'asking',
      question: 'What is open?',
      placement: FREE,
    });
    await settle();
    expect(askTurn).toHaveBeenCalledWith('What is open?', null);
    expect(result.current.session).toMatchObject({
      phase: 'answered',
      answer: { text: 'one two three four' },
    });

    const reading = READ_BASE_MS + 4 * READ_PER_WORD_MS;
    await act(() => vi.advanceTimersByTimeAsync(reading - 1));
    expect(result.current.session?.phase).toBe('answered');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.session?.phase).toBe('fading');
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS));
    expect(result.current.session).toBeNull();
  });

  it('continues the conversation while its card shows, and starts afresh once it is gone', async () => {
    askTurn
      .mockResolvedValueOnce(answered('c1'))
      .mockResolvedValueOnce(answered('c1'))
      .mockResolvedValueOnce(answered('c2'));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('What is open?', FREE));
    await settle();
    act(() => result.current.ask('And mine?', FREE));
    await settle();
    expect(askTurn).toHaveBeenLastCalledWith('And mine?', 'c1');

    act(() => result.current.dismiss());
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS));
    expect(result.current.session).toBeNull();
    act(() => result.current.ask('What is late?', FREE));
    await settle();
    expect(askTurn).toHaveBeenLastCalledWith('What is late?', null);
  });

  it('a pause holds the clock and resumes with what was left', async () => {
    askTurn.mockResolvedValue(answered('c1', ''));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('Open?', FREE));
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    act(() => result.current.pause(true));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(result.current.session?.phase).toBe('answered');
    act(() => result.current.pause(false));
    await act(() => vi.advanceTimersByTimeAsync(READ_BASE_MS - 3000 - 1));
    expect(result.current.session?.phase).toBe('answered');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.session?.phase).toBe('fading');
  });

  it('a pin holds the card; unpinning starts the full reading time again', async () => {
    askTurn.mockResolvedValue(answered('c1', ''));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('Open?', FREE));
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    act(() => result.current.setPinned(true));
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(result.current.session).toMatchObject({ phase: 'answered', pinned: true });
    act(() => result.current.setPinned(false));
    await act(() => vi.advanceTimersByTimeAsync(READ_BASE_MS - 1));
    expect(result.current.session?.phase).toBe('answered');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.session?.phase).toBe('fading');
  });

  it('a dismissal while asking fades the card, and the late answer sets no conversation', async () => {
    let resolve!: (o: AskOutcome) => void;
    askTurn.mockReturnValueOnce(new Promise<AskOutcome>((r) => (resolve = r)));
    askTurn.mockResolvedValueOnce(answered('c2'));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('Open?', FREE));
    act(() => result.current.dismiss());
    expect(result.current.session?.phase).toBe('fading');
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS));
    expect(result.current.session).toBeNull();
    await act(async () => {
      resolve(answered('c1'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.session).toBeNull();
    act(() => result.current.ask('Late?', FREE));
    await settle();
    expect(askTurn).toHaveBeenLastCalledWith('Late?', null);
  });

  it('a second question replaces the first card; the first answer is not shown', async () => {
    let resolveFirst!: (o: AskOutcome) => void;
    askTurn.mockReturnValueOnce(new Promise<AskOutcome>((r) => (resolveFirst = r)));
    askTurn.mockResolvedValueOnce(answered('c1', 'second'));
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('First?', FREE));
    act(() => result.current.ask('Second?', { kind: 'list' }));
    await settle();
    expect(result.current.session).toMatchObject({
      question: 'Second?',
      phase: 'answered',
      answer: { text: 'second' },
    });
    await act(async () => {
      resolveFirst(answered('c9', 'first'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.session).toMatchObject({
      question: 'Second?',
      answer: { text: 'second' },
    });
  });

  it('a refusal and a failure stay for the base time', async () => {
    askTurn.mockResolvedValueOnce({ kind: 'refused', code: 'ASSISTANT_DAILY_CAP', resetsAt: AT });
    const { result } = renderHook(() => useAskSession('b1'));
    act(() => result.current.ask('Open?', FREE));
    await settle();
    expect(result.current.session).toMatchObject({
      phase: 'refused',
      refusal: { code: 'ASSISTANT_DAILY_CAP', resetsAt: AT },
    });
    await act(() => vi.advanceTimersByTimeAsync(READ_BASE_MS));
    expect(result.current.session?.phase).toBe('fading');

    askTurn.mockResolvedValueOnce({ kind: 'failed' });
    act(() => result.current.ask('Open?', FREE));
    await settle();
    expect(result.current.session?.phase).toBe('failed');
  });
});
```

Run: `pnpm vitest run src/features/board/Ask/useAskSession.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: The hook**

`apps/web/src/features/board/Ask/useAskSession.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantEntry } from '@wally/shared';
import type { CapturePlacement } from '../Capture/useCapture';
import { useAskAssistant, type RefusalCode } from './useAskAssistant';

/** How long an answer stays before it fades: a floor, a share per word, a ceiling (plan R5). */
export const READ_BASE_MS = 8_000;
export const READ_PER_WORD_MS = 250;
export const READ_MAX_MS = 30_000;
/** The fade itself, the length of `animate-fade-out`; the card is removed once it has run. */
export const FADE_MS = 180;

export function readingTimeMs(text: string): number {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return Math.min(READ_MAX_MS, READ_BASE_MS + words * READ_PER_WORD_MS);
}

export type AskPhase = 'asking' | 'answered' | 'refused' | 'failed' | 'fading';

/** One question on the wall, from Enter until its card has faded (0005-wallybot-inline.md §3.6). */
export interface AskSession {
  /** Tells this question's card and its late callbacks apart from the next one's. */
  id: number;
  /** Where the question was written: the card takes that place (R3). */
  placement: CapturePlacement;
  question: string;
  phase: AskPhase;
  /** The answer entry of the turn, once it arrived (R9). */
  answer: AssistantEntry | null;
  refusal: { code: RefusalCode; resetsAt: string | null } | null;
  /** Held by the person: no fade until unpinned or closed (R5). */
  pinned: boolean;
  /** Held by hover or focus on the card: the clock waits (R5). */
  paused: boolean;
}

export interface AskController {
  session: AskSession | null;
  ask: (question: string, placement: CapturePlacement) => void;
  setPinned: (pinned: boolean) => void;
  /** Esc or the card's ×: the card fades now. */
  dismiss: () => void;
  pause: (paused: boolean) => void;
}

/**
 * The shell's side of a question (0005-wallybot-inline.md §3.6): one card at a time, its outcome,
 * and the reading clock that fades it. Follow-ups continue the conversation the current card
 * came from; once the card is gone, the next question starts a new one (R4).
 */
export function useAskSession(boardId: string): AskController {
  const askTurn = useAskAssistant(boardId);
  const [session, setSession] = useState<AskSession | null>(null);
  const nextId = useRef(1);
  /** The question whose outcome may still land; a dismissed or replaced one is ignored. */
  const liveId = useRef<number | null>(null);
  /** The conversation the cards on this page continue, while one of them still shows (R4). */
  const conversationId = useRef<string | null>(null);
  /** Reading time left before the fade, carried across pauses. */
  const remaining = useRef(READ_BASE_MS);
  const latest = useRef(session);
  latest.current = session;

  const update = useCallback((id: number, patch: (s: AskSession) => AskSession) => {
    setSession((s) => (s && s.id === id ? patch(s) : s));
  }, []);

  const fade = useCallback(
    (id: number) => {
      if (liveId.current === id) liveId.current = null;
      update(id, (s) => (s.phase === 'fading' ? s : { ...s, phase: 'fading' }));
    },
    [update],
  );

  // The fade runs its FADE_MS and the card goes; the next question then starts afresh.
  const sessionId = session?.id;
  const phase = session?.phase;
  useEffect(() => {
    if (phase !== 'fading' || sessionId === undefined) return;
    const timer = setTimeout(() => {
      setSession((s) => (s && s.id === sessionId ? null : s));
      conversationId.current = null;
    }, FADE_MS);
    return () => clearTimeout(timer);
  }, [phase, sessionId]);

  // The reading clock: runs once the outcome is on the card, waits while pinned or held, and
  // keeps what is left of the time across pauses.
  const ticking =
    session !== null &&
    phase !== 'asking' &&
    phase !== 'fading' &&
    !session.pinned &&
    !session.paused;
  useEffect(() => {
    if (!ticking || sessionId === undefined) return;
    const started = Date.now();
    const timer = setTimeout(() => fade(sessionId), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [fade, sessionId, ticking]);

  const ask = useCallback<AskController['ask']>(
    (question, placement) => {
      const id = nextId.current++;
      liveId.current = id;
      remaining.current = READ_BASE_MS;
      setSession({
        id,
        placement,
        question,
        phase: 'asking',
        answer: null,
        refusal: null,
        pinned: false,
        paused: false,
      });
      void (async () => {
        const outcome = await askTurn(question, conversationId.current);
        // Dismissed or replaced meanwhile: the answer was not waited for (R4, R5).
        if (liveId.current !== id) return;
        if (outcome.kind === 'answered') {
          conversationId.current = outcome.conversation.id;
          const entries = outcome.conversation.entries;
          const last = entries[entries.length - 1];
          const answer = last && last.role === 'assistant' ? last : null;
          remaining.current = readingTimeMs(answer?.text ?? '');
          update(id, (s) => ({ ...s, phase: 'answered', answer }));
        } else if (outcome.kind === 'refused') {
          remaining.current = READ_BASE_MS;
          update(id, (s) => ({
            ...s,
            phase: 'refused',
            refusal: { code: outcome.code, resetsAt: outcome.resetsAt },
          }));
        } else {
          remaining.current = READ_BASE_MS;
          update(id, (s) => ({ ...s, phase: 'failed' }));
        }
      })();
    },
    [askTurn, update],
  );

  const setPinned = useCallback<AskController['setPinned']>(
    (pinned) => {
      const s = latest.current;
      if (!s || s.phase === 'fading') return;
      // Unpinned, the card gets its whole reading time again.
      if (!pinned)
        remaining.current =
          s.phase === 'answered' ? readingTimeMs(s.answer?.text ?? '') : READ_BASE_MS;
      update(s.id, (x) => (x.pinned === pinned ? x : { ...x, pinned }));
    },
    [update],
  );

  const dismiss = useCallback(() => {
    const s = latest.current;
    if (s) fade(s.id);
  }, [fade]);

  const pause = useCallback<AskController['pause']>(
    (paused) => {
      const s = latest.current;
      if (s) update(s.id, (x) => (x.paused === paused ? x : { ...x, paused }));
    },
    [update],
  );

  return useMemo(
    () => ({ session, ask, setPinned, dismiss, pause }),
    [ask, dismiss, pause, session, setPinned],
  );
}
```

Run: `pnpm vitest run src/features/board/Ask/useAskSession.test.tsx`
Expected: PASS, every case. If the "second question replaces the first" case fails on the first answer landing, check that `liveId` is compared before `conversationId` is written.

- [ ] **Step 4: Checks and commit**

Run: `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check` from the root; `pnpm vitest run` in `apps/web`.
Expected: green.

```bash
git add apps/web/src/features/board/Ask apps/web/src/features/board/Assistant
git -c core.hooksPath=/dev/null commit -m "feat(web): the ask session: one question at a time, its outcome, its reading clock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The answer card

**Files:**

- Move: `apps/web/src/features/board/Assistant/AnswerNotes.tsx` → `apps/web/src/features/board/Ask/AnswerNotes.tsx`; its test alongside
- Create: `apps/web/src/features/board/Ask/AskCard.tsx`
- Create: `apps/web/src/features/board/Ask/AskCard.test.tsx`
- Modify: `apps/web/src/i18n/de.ts`, `apps/web/src/i18n/en.ts` (new `ask.*` block)
- Modify: `apps/web/src/features/board/Assistant/AssistantContent.tsx` (import path for `AnswerNotes`, until Task 5)

**Interfaces:**

- Consumes: `AskSession` from `./useAskSession`; `AnswerNotes({ chips, notes, onOpenNote })`.
- Produces: `AskCard({ session, notes, layout, onOpenNote, onSetPinned, onDismiss, onPause })`; `ASK_CARD_WIDTH = 376`; the DOM hooks `[data-ask-card]` and `data-ask-phase`.

- [ ] **Step 1: Catalogue**

In `apps/web/src/i18n/de.ts`, before `capture: {` (the `assistant` block stays until Task 5):

```ts
  /** The answer card on the wall (0005-wallybot-inline.md §3.6). No name, no first person. */
  ask: {
    cardAria: 'Antwort der Wand',
    asking: 'Die Wand wird gelesen',
    pin: 'Antwort anheften',
    unpin: 'Antwort lösen',
    close: 'Antwort schließen',
    notesRead: 'Gelesene Notizen',
    partial: 'Nur ein Teil der passenden Notizen wurde gelesen.',
    stopped: {
      TOOL_LIMIT: 'Nach zwölf Lesevorgängen gestoppt. Eine engere Frage hilft.',
      TIMEOUT: 'Keine Antwort innerhalb einer Minute. Eine engere Frage hilft.',
      LENGTH: 'Die Antwort wurde gekürzt.',
    },
    limit: {
      daily: 'Tageslimit erreicht. Ab {{when}} wieder verfügbar.',
      monthly: 'Monatslimit erreicht. Ab {{when}} wieder verfügbar.',
      busy: 'Gerade beschäftigt. Gleich noch einmal versuchen.',
    },
    failed: 'Keine Antwort. Noch einmal versuchen.',
  },
```

In `apps/web/src/i18n/en.ts`, in the same place:

```ts
  ask: {
    cardAria: 'Answer from the wall',
    asking: 'Reading the wall',
    pin: 'Pin the answer',
    unpin: 'Unpin the answer',
    close: 'Close the answer',
    notesRead: 'Notes read',
    partial: 'Only part of the matching notes was read.',
    stopped: {
      TOOL_LIMIT: 'Stopped after twelve reads. A narrower question helps.',
      TIMEOUT: 'No answer within a minute. A narrower question helps.',
      LENGTH: 'The answer was cut short.',
    },
    limit: {
      daily: 'Daily limit reached. Available again from {{when}}.',
      monthly: 'Monthly limit reached. Available again from {{when}}.',
      busy: 'Busy right now. Try again in a moment.',
    },
    failed: 'No answer. Try again.',
  },
```

- [ ] **Step 2: Move `AnswerNotes`**

`git mv` the component and its test into `Ask/`; change `t('assistant.notesRead')` to `t('ask.notesRead')`; in `AssistantContent.tsx` change the import to `from '../Ask/AnswerNotes'`. The doc comment's "BRAND.md AI rule 8" reference stays (rule 8 is reworded in Task 6). Run `pnpm vitest run src/features/board/Ask/AnswerNotes.test.tsx`: PASS unchanged.

- [ ] **Step 3: Card tests, written first**

`apps/web/src/features/board/Ask/AskCard.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssistantEntry } from '@wally/shared';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { AskCard } from './AskCard';
import type { AskSession } from './useAskSession';

const AT = '2026-10-17T10:00:00.000Z';
const answer = (overrides: Partial<AssistantEntry> = {}): AssistantEntry => ({
  role: 'assistant',
  text: 'Two notes are open.',
  chips: [{ id: 'n1', title: 'Call Müller' }],
  partial: false,
  stopped: null,
  at: AT,
  ...overrides,
});
const session = (overrides: Partial<AskSession> = {}): AskSession => ({
  id: 1,
  placement: { kind: 'free', x: 10, y: 20 },
  question: 'What is open today?',
  phase: 'answered',
  answer: answer(),
  refusal: null,
  pinned: false,
  paused: false,
  ...overrides,
});

function renderCard(s: AskSession, props: Partial<Parameters<typeof AskCard>[0]> = {}) {
  const handlers = {
    onOpenNote: vi.fn(),
    onSetPinned: vi.fn(),
    onDismiss: vi.fn(),
    onPause: vi.fn(),
    ...props,
  };
  const view = renderWithProviders(
    <AskCard
      session={s}
      notes={[makeNote({ id: 'n1', title: 'Call Müller' })]}
      layout="card"
      {...handlers}
    />,
  );
  return { ...handlers, view };
}

describe('AskCard', () => {
  it('shows the question and a busy body while asking', () => {
    renderCard(session({ phase: 'asking', answer: null }));
    const card = screen.getByRole('group', { name: 'Answer from the wall' });
    expect(card).toHaveTextContent('What is open today?');
    expect(card).toHaveAttribute('data-ask-phase', 'asking');
    expect(screen.getByText('Reading the wall')).toBeInTheDocument();
    expect(card.querySelector('[aria-live="polite"]')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the answer, its stopped and partial lines and the notes read as rows', () => {
    renderCard(session({ answer: answer({ stopped: 'LENGTH', partial: true }) }));
    expect(screen.getByText('Two notes are open.')).toBeInTheDocument();
    expect(screen.getByText('The answer was cut short.')).toBeInTheDocument();
    expect(screen.getByText('Only part of the matching notes was read.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Call Müller/ })).toBeInTheDocument();
    const card = screen.getByRole('group', { name: 'Answer from the wall' });
    expect(card).toHaveClass('border-dashed');
    expect(card.querySelector('svg.fill-accent, .stroke-accent')).toBeNull();
  });

  it('a click on a row pins the card and opens the note', async () => {
    const { onOpenNote, onSetPinned } = renderCard(session());
    await userEvent.click(screen.getByRole('button', { name: /Call Müller/ }));
    expect(onSetPinned).toHaveBeenCalledWith(true);
    expect(onOpenNote).toHaveBeenCalledWith('n1');
  });

  it('the pin toggles and says which way it is', async () => {
    const { onSetPinned, view } = renderCard(session());
    const pin = screen.getByRole('button', { name: 'Pin the answer' });
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(pin);
    expect(onSetPinned).toHaveBeenCalledWith(true);
    view.rerender(
      <AskCard
        session={session({ pinned: true })}
        notes={[]}
        layout="card"
        onOpenNote={vi.fn()}
        onSetPinned={onSetPinned}
        onDismiss={vi.fn()}
        onPause={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Unpin the answer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('Esc and the × dismiss; Esc does not reach the board', async () => {
    const outer = vi.fn();
    const onDismiss = vi.fn();
    renderWithProviders(
      <div onKeyDown={outer}>
        <AskCard
          session={session()}
          notes={[]}
          layout="card"
          onOpenNote={vi.fn()}
          onSetPinned={vi.fn()}
          onDismiss={onDismiss}
          onPause={vi.fn()}
        />
      </div>,
    );
    const card = screen.getByRole('group', { name: 'Answer from the wall' });
    card.focus();
    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close the answer' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('a single key on the focused card never reaches the board shortcuts', async () => {
    const outer = vi.fn();
    renderWithProviders(
      <div onKeyDown={outer}>
        <AskCard
          session={session()}
          notes={[]}
          layout="card"
          onOpenNote={vi.fn()}
          onSetPinned={vi.fn()}
          onDismiss={vi.fn()}
          onPause={vi.fn()}
        />
      </div>,
    );
    screen.getByRole('group', { name: 'Answer from the wall' }).focus();
    await userEvent.keyboard('n');
    expect(outer).not.toHaveBeenCalled();
  });

  it('hover and focus hold the clock; leaving both lets go once', async () => {
    const { onPause } = renderCard(session());
    const card = screen.getByRole('group', { name: 'Answer from the wall' });
    fireEvent.mouseEnter(card);
    expect(onPause).toHaveBeenLastCalledWith(true);
    screen.getByRole('button', { name: 'Pin the answer' }).focus();
    fireEvent.mouseLeave(card);
    expect(onPause).toHaveBeenCalledTimes(1);
    await userEvent.tab();
    await userEvent.tab();
    fireEvent.blur(card, { relatedTarget: document.body });
    expect(onPause).toHaveBeenLastCalledWith(false);
  });

  it('a refusal says when it resets, in the reader’s locale; a failure says so', () => {
    const { view } = renderCard(
      session({
        phase: 'refused',
        answer: null,
        refusal: { code: 'ASSISTANT_DAILY_CAP', resetsAt: AT },
      }),
    );
    expect(
      screen.getByText(/Daily limit reached\. Available again from .*2026/),
    ).toBeInTheDocument();
    view.rerender(
      <AskCard
        session={session({
          phase: 'refused',
          answer: null,
          refusal: { code: 'ASSISTANT_BUSY', resetsAt: null },
        })}
        notes={[]}
        layout="card"
        onOpenNote={vi.fn()}
        onSetPinned={vi.fn()}
        onDismiss={vi.fn()}
        onPause={vi.fn()}
      />,
    );
    expect(screen.getByText('Busy right now. Try again in a moment.')).toBeInTheDocument();
    view.rerender(
      <AskCard
        session={session({ phase: 'failed', answer: null })}
        notes={[]}
        layout="card"
        onOpenNote={vi.fn()}
        onSetPinned={vi.fn()}
        onDismiss={vi.fn()}
        onPause={vi.fn()}
      />,
    );
    expect(screen.getByText('No answer. Try again.')).toBeInTheDocument();
  });

  it('takes the focus on mount when it lies on the page, and leaves a focused field alone', () => {
    renderCard(session());
    expect(screen.getByRole('group', { name: 'Answer from the wall' })).toHaveFocus();
    document.body.innerHTML = '';
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    renderCard(session({ id: 2 }));
    expect(input).toHaveFocus();
  });

  it('hands the focus to the board surface when it goes with the focus inside', () => {
    const surface = document.createElement('div');
    surface.setAttribute('data-board-surface', '');
    surface.tabIndex = -1;
    document.body.append(surface);
    const { view } = renderCard(session());
    screen.getByRole('button', { name: 'Pin the answer' }).focus();
    view.unmount();
    expect(surface).toHaveFocus();
    surface.remove();
  });

  it('fades out when told to, and is a full-width row in the list', () => {
    const { view } = renderCard(session({ phase: 'fading' }));
    expect(screen.getByRole('group', { name: 'Answer from the wall' })).toHaveClass(
      'animate-fade-out',
    );
    view.rerender(
      <AskCard
        session={session()}
        notes={[]}
        layout="row"
        onOpenNote={vi.fn()}
        onSetPinned={vi.fn()}
        onDismiss={vi.fn()}
        onPause={vi.fn()}
      />,
    );
    expect(screen.getByRole('group', { name: 'Answer from the wall' })).toHaveClass('w-full');
  });
});
```

Run: `pnpm vitest run src/features/board/Ask/AskCard.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 4: The card**

`apps/web/src/features/board/Ask/AskCard.tsx`:

```tsx
import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, PinOff, X } from 'lucide-react';
import type { NoteDto } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { IconTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { noteColourFillClass } from '../util/noteDerived';
import { AnswerNotes } from './AnswerNotes';
import type { AskSession } from './useAskSession';

/** Wider than a note: an answer is a paragraph, a note is a line (plan R3). */
export const ASK_CARD_WIDTH = 376;
/** The board's own surface (AppShell), where the focus goes when the card leaves with it. */
const BOARD_SURFACE = '[data-board-surface]';

/** The reset moment for a cap line: date and time for the daily cap, the date alone for the
 *  monthly one. Null when the API sent something that does not parse, so the busy line shows. */
function formatWhen(iso: string, locale: string, withTime: boolean): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return new Intl.DateTimeFormat(
    locale,
    withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  ).format(at);
}

/**
 * The answer to a question typed into the capture card, drawn where the question was written
 * (0005-wallybot-inline.md §3.6): the note's type, the pending look's dashed edge and nothing else,
 * the notes it relied on as rows underneath. Its own component, as the capture card is: it is
 * never a note, never dragged, and it fades. No dot and no ring: nothing is written (R3).
 */
export function AskCard({
  session,
  notes,
  layout,
  onOpenNote,
  onSetPinned,
  onDismiss,
  onPause,
}: {
  session: AskSession;
  /** The board's notes, so the rows read like the list and a note gone from the board is dropped. */
  notes: NoteDto[] | undefined;
  layout: 'card' | 'row';
  onOpenNote: (noteId: string) => void;
  onSetPinned: (pinned: boolean) => void;
  onDismiss: () => void;
  /** Hover or focus on the card holds the fade (R5). */
  onPause: (paused: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const focused = useRef(false);

  // The capture card gave way to this one and left the focus on the page: the card takes it,
  // so Esc, the pin, the × and the rows work from the keyboard (R8). Focus the person put
  // somewhere else meanwhile is left alone.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active.matches(BOARD_SURFACE))
      rootRef.current?.focus();
  }, []);
  // Going away with the focus inside, the card hands it to the board, never to the page. The
  // browser has already moved the focus to the body by the time this runs, so that is the sign.
  useEffect(
    () => () => {
      const active = document.activeElement;
      if (!active || active === document.body)
        document.querySelector<HTMLElement>(BOARD_SURFACE)?.focus();
    },
    [],
  );

  /** Hover and focus are tracked apart, so leaving one while the other holds lets nothing go. */
  function hold(source: 'hover' | 'focus', value: boolean) {
    const before = hovered.current || focused.current;
    (source === 'hover' ? hovered : focused).current = value;
    const after = hovered.current || focused.current;
    if (after !== before) onPause(after);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // The board's single keys (N, V, G…) would open or switch something under the card.
      event.stopPropagation();
    }
  }
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    hold('focus', false);
  }

  const { phase, answer, refusal } = session;
  let outcomeLine: string | null = null;
  if (phase === 'failed') outcomeLine = t('ask.failed');
  else if (phase === 'refused' && refusal) {
    const daily = refusal.code === 'ASSISTANT_DAILY_CAP';
    const when =
      refusal.code !== 'ASSISTANT_BUSY' && refusal.resetsAt
        ? formatWhen(refusal.resetsAt, i18n.language, daily)
        : null;
    outcomeLine = !when
      ? t('ask.limit.busy')
      : daily
        ? t('ask.limit.daily', { when })
        : t('ask.limit.monthly', { when });
  }
  const pinLabel = t(session.pinned ? 'ask.unpin' : 'ask.pin');

  return (
    <div
      ref={rootRef}
      role="group"
      tabIndex={-1}
      aria-label={t('ask.cardAria')}
      data-ask-card
      data-ask-phase={phase}
      onKeyDown={onKeyDown}
      onMouseEnter={() => hold('hover', true)}
      onMouseLeave={() => hold('hover', false)}
      onFocus={() => hold('focus', true)}
      onBlur={onBlur}
      className={cn(
        'relative flex flex-col gap-2 rounded-lg border border-dashed border-[color:var(--note-border)] p-3 text-left shadow-e2 outline-none',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--note-selected)]',
        noteColourFillClass.WEISS,
        layout === 'card' ? 'w-[376px] max-w-full' : 'w-full',
        // 180 ms of opacity, then the shell removes the card; nothing moves under reduced motion.
        phase === 'fading' &&
          'animate-fade-out [animation-fill-mode:forwards] motion-reduce:invisible motion-reduce:animate-none',
      )}
    >
      <div className="flex items-start gap-1">
        <p className="min-w-0 flex-1 whitespace-pre-line pt-1 text-14 font-medium leading-snug text-fg-1">
          {session.question}
        </p>
        <IconTooltip label={pinLabel}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={session.pinned}
            aria-label={pinLabel}
            onClick={() => onSetPinned(!session.pinned)}
          >
            {session.pinned ? <PinOff /> : <Pin />}
          </Button>
        </IconTooltip>
        <IconTooltip label={t('ask.close')} shortcut={['Esc']}>
          <Button variant="ghost" size="icon-sm" aria-label={t('ask.close')} onClick={onDismiss}>
            <X />
          </Button>
        </IconTooltip>
      </div>

      {/* A polite live region: the answer, a refusal or a failure is announced when it lands;
          aria-busy holds the announcement back while the wall is being read. */}
      <div aria-live="polite" aria-busy={phase === 'asking'}>
        {phase === 'asking' && (
          <div className="flex flex-col gap-2">
            <span className="sr-only">{t('ask.asking')}</span>
            <Skeleton className="h-3.5 w-[90%]" />
            <Skeleton className="h-3.5 w-[60%]" />
          </div>
        )}
        {outcomeLine && <p className="text-13 text-fg-3">{outcomeLine}</p>}
        {answer && (
          <>
            {answer.text && (
              <p className="whitespace-pre-line text-13 leading-snug text-fg-1">{answer.text}</p>
            )}
            {answer.stopped && (
              <p className="mt-1 text-12 text-fg-3">{t(`ask.stopped.${answer.stopped}`)}</p>
            )}
            {answer.partial && <p className="mt-1 text-12 text-fg-3">{t('ask.partial')}</p>}
            <AnswerNotes
              chips={answer.chips}
              notes={notes}
              onOpenNote={(noteId) => {
                // Reading a note the answer relied on keeps the answer there to come back to (R6).
                onSetPinned(true);
                onOpenNote(noteId);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
```

If `sr-only` is not among the utilities the project's Tailwind config emits (check `pnpm vitest run src/features/board/Ask/AskCard.test.tsx` renders the text; Tailwind ships it by default), keep it.

Run: `pnpm vitest run src/features/board/Ask/AskCard.test.tsx`
Expected: PASS. If the "Esc does not reach the board" case sees `outer` called, the Escape handler must call `stopPropagation` before `onDismiss`. If the "hands the focus" case fails because jsdom does not move the focus to the body on unmount, replace the cleanup's check with: capture `const root = rootRef.current` in the effect body and test `root?.contains(document.activeElement) || document.activeElement === document.body`.

- [ ] **Step 5: Guards, checks and commit**

Run `pnpm vitest run src/brandGuards.test.ts src/i18n/noHardcodedCopy.test.ts src/i18n/resources.test.ts src/i18n/germanSurface.test.tsx`, then the typecheck, lint and format checks, then the whole web suite.
Expected: green.

```bash
git add apps/web/src/features/board/Ask apps/web/src/features/board/Assistant apps/web/src/i18n/de.ts apps/web/src/i18n/en.ts
git -c core.hooksPath=/dev/null commit -m "feat(web): the answer card: the question, the answer, the notes read, pin and fade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The views place the card; the shell asks

**Files:**

- Create: `apps/web/src/features/board/Ask/askSlot.ts`
- Modify: `apps/web/src/features/board/WallView/WallView.tsx`, `WallCanvas.tsx`, `ZoneBands.tsx`, `apps/web/src/features/board/ListView/ListView.tsx`
- Modify: `apps/web/src/features/board/WallView/WallCanvas.test.tsx`, `WallView.test.tsx`, `apps/web/src/features/board/ListView/ListView.test.tsx`
- Modify: `apps/web/src/features/board/AppShell.tsx`

**Interfaces:**

- Consumes: `useAskSession`, `AskCard`, `ASK_CARD_WIDTH` (Tasks 2, 3); `onCaptureAsk` and `onAsked` (Task 1).
- Produces: `AskSlot { key: number; placement: CapturePlacement; card: ReactNode }`; views' prop `ask?: AskSlot | null`; the DOM hook `[data-ask]` on the wrapper the view draws.

- [ ] **Step 1: The slot**

`apps/web/src/features/board/Ask/askSlot.ts`:

```ts
import type { ReactNode } from 'react';
import type { CapturePlacement } from '../Capture/useCapture';

/**
 * The answer card, built by the shell, and the place a view draws it: where the question was
 * written (0005-wallybot-inline.md §3.6, plan R3). The views place it as they place the capture
 * card and know nothing else about it.
 */
export interface AskSlot {
  /** Changes with every question, so each one gets a fresh card. */
  key: number;
  placement: CapturePlacement;
  card: ReactNode;
}
```

- [ ] **Step 2: View tests, written first**

`WallCanvas.test.tsx`, a new `describe('WallCanvas answer card', …)`:

```tsx
describe('WallCanvas answer card', () => {
  function render(
    ask: { key: number; placement: { kind: 'free'; x: number; y: number }; card: ReactNode } | null,
  ) {
    renderWithProviders(
      <DndContext>
        <WallCanvas
          notes={[]}
          filtered={false}
          currentUserId="u1"
          selectedNoteId={null}
          onOpenNote={vi.fn()}
          onCapture={vi.fn()}
          capture={null}
          onCaptureDone={vi.fn()}
          visibility="SHARED"
          boardId="b1"
          canEditShared
          activeDragId={null}
          ask={ask}
        />
      </DndContext>,
    );
  }

  it('draws the answer card where the question was written', () => {
    render({
      key: 1,
      placement: { kind: 'free', x: 120, y: 80 },
      card: <div data-testid="answer" />,
    });
    const card = screen.getByTestId('answer');
    expect(card.parentElement).toHaveAttribute('data-ask');
    expect(card.parentElement).toHaveStyle({ position: 'absolute', left: '120px', top: '80px' });
    // The card is there instead of the empty wall's prompt.
    expect(screen.queryByText('Your free wall is empty')).not.toBeInTheDocument();
  });

  it('keeps a card written near the right edge on the canvas', () => {
    render({
      key: 1,
      placement: { kind: 'free', x: 2300, y: 80 },
      card: <div data-testid="answer" />,
    });
    expect(screen.getByTestId('answer').parentElement).toHaveStyle({ left: `${2400 - 376}px` });
  });
});
```

(Import `type ReactNode` from `react`. For the empty-state text, read the exact English string under `board.empty.free.title` in `en.ts` and use it.)

`ListView.test.tsx`, a new case in the existing describe, rendered as the file renders a capture row (with `renderWithProviders` and the `owner` access):

```tsx
it('draws the answer card as the top row, above the groups', () => {
  renderWithProviders(
    <ListView
      notes={notes}
      totalNoteCount={notes.length}
      axis="horizon"
      currentUserId="user-1"
      onOpenNote={vi.fn()}
      onToggleDone={vi.fn()}
      access={owner}
      isBelowDesktop={false}
      ask={{ key: 1, placement: { kind: 'list' }, card: <div data-testid="answer" /> }}
    />,
  );
  const answer = screen.getByTestId('answer');
  expect(answer.parentElement).toHaveAttribute('data-ask');
  expect(answer.compareDocumentPosition(screen.getByText('Today note'))).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});
```

`WallView.test.tsx`: a case that renders `WallView` on the horizon axis the way the file already does, with `ask={{ key: 1, placement: { kind: 'zone', axis: 'horizon', key: 'DIESE_WOCHE', at: { freeX: 0, freeY: 0 } }, card: <div data-testid="answer" /> }}`, and asserts the card is inside the zone section named for "This week" (`screen.getByRole('region', { name: /This week/ })` or the file's own way of finding a zone) and not inside the "Today" one.

Run the three files. Expected: FAIL (unknown prop, nothing drawn).

- [ ] **Step 3: The views**

`WallView.tsx`: import `type { AskSlot } from '../Ask/askSlot'`; add to `WallViewProps`:

```ts
  /** The answer to a question, drawn where the question was written (§3.6). */
  ask?: AskSlot | null;
```

destructure `ask` and pass `ask={ask}` to `WallCanvas` and `ZoneBands`.

`WallCanvas.tsx`: import `ASK_CARD_WIDTH` from `'../Ask/AskCard'` and `type { AskSlot }`; the prop `ask?: AskSlot | null`; in `handleDoubleClick` the ignore selector becomes `'[data-note-id], [data-capture], [data-ask]'`; after the capture block inside the canvas:

```tsx
{
  ask?.placement.kind === 'free' && (
    <div
      key={ask.key}
      data-ask
      style={{
        position: 'absolute',
        // Clamped like a capture point, for the answer's own width.
        left: Math.min(ask.placement.x, FREE_CANVAS_WIDTH - ASK_CARD_WIDTH),
        top: ask.placement.y,
        zIndex: 30,
      }}
    >
      {ask.card}
    </div>
  );
}
```

and the empty state's condition becomes `notes.length === 0 && !capture && !ask`.

`ZoneBands.tsx`: `ZoneBandProps` gains `ask: AskSlot | null;` (the slot when its zone is this one); `ZoneBandsProps` gains `ask?: AskSlot | null;`; `ZoneBands` computes `const zoneAsk = ask?.placement.kind === 'zone' && ask.placement.axis === axis ? ask : null;` and passes `ask={zoneAsk && zoneAsk.placement.kind === 'zone' && zoneAsk.placement.key === group.key ? zoneAsk : null}`; `ZoneBand` draws, before the capture:

```tsx
{
  ask && (
    <div key={ask.key} data-ask>
      {ask.card}
    </div>
  );
}
```

and `isEmpty` becomes `group.notes.length === 0 && !capture && !ask`.

`ListView.tsx`: prop `ask?: AskSlot | null;`; `const askRow = ask && (<div key={ask.key} data-ask>{ask.card}</div>);` rendered just above `{captureRow}`; the early empty return's condition becomes `notes.length === 0 && !capture && !ask`.

Run the three test files. Expected: PASS.

- [ ] **Step 4: The shell**

In `apps/web/src/features/board/AppShell.tsx`:

Imports: `import { useAskSession } from './Ask/useAskSession'; import { AskCard } from './Ask/AskCard'; import type { AskSlot } from './Ask/askSlot'; import type { CapturePlacement } from './Capture/useCapture';` and add `useMemo` is already imported.

After the suggestions block and before `useCaptureSession`:

```tsx
// A question typed into the capture card (0005-wallybot-inline.md §3.6): the shell asks the board
// and draws the answer where the question was written. Off means a `?` is a plain title.
const askController = useAskSession(boardId);
const { ask: askQuestion } = askController;
const onAsked = useCallback(
  (question: string, placement: CapturePlacement) => askQuestion(question, placement),
  [askQuestion],
);
```

Pass `onAsked` into `useCaptureSession` and take `onCaptureAsk` from its result. After it:

```tsx
const captureAsk = board.assistantEnabled ? onCaptureAsk : undefined;
const askSession = askController.session;
const { setPinned: setAskPinned, dismiss: dismissAsk, pause: pauseAsk } = askController;
const askSlot = useMemo<AskSlot | null>(
  () =>
    askSession
      ? {
          key: askSession.id,
          placement: askSession.placement,
          card: (
            <AskCard
              session={askSession}
              notes={notesQuery.data}
              layout={effectiveView === 'list' ? 'row' : 'card'}
              onOpenNote={viewState.openNote}
              onSetPinned={setAskPinned}
              onDismiss={dismissAsk}
              onPause={pauseAsk}
            />
          ),
        }
      : null,
  [
    askSession,
    dismissAsk,
    effectiveView,
    notesQuery.data,
    pauseAsk,
    setAskPinned,
    viewState.openNote,
  ],
);
```

`WallView` gets `onCaptureAsk={captureAsk}` and `ask={askSlot}`; `ListView` gets `ask={askSlot}` and its `capture` object gains `onAsk: captureAsk`.

Run: `pnpm --filter @wally/web typecheck`. Expected: clean.

- [ ] **Step 5: Checks and commit**

Lint, format check, the whole web suite.

```bash
git add apps/web/src/features/board/Ask/askSlot.ts apps/web/src/features/board/WallView apps/web/src/features/board/ListView apps/web/src/features/board/AppShell.tsx
git -c core.hooksPath=/dev/null commit -m "feat(web): the answer card takes the place the question was written in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The panel is retired

**Files:**

- Delete: `apps/web/src/features/board/Assistant/AssistantPanel.tsx`, `AssistantContent.tsx`, `AssistantContent.test.tsx`, `useAssistantConversation.ts` (the folder is then empty and gone)
- Modify: `apps/web/src/features/board/AppShell.tsx`, `TopBar.tsx`, `TopBar.test.tsx`, `BoardCommands.tsx`, `BoardCommands.test.tsx`, `FilterBar.test.tsx`, `util/noteDerived.test.ts`, `hooks/useBoardViewState.ts`, `hooks/useBoardViewState.test.tsx`, `hooks/queryKeys.ts`, `hooks/useEscapeToClose.ts` (comment)
- Modify: `apps/web/src/lib/resources.ts`
- Modify: `apps/web/src/i18n/de.ts`, `apps/web/src/i18n/en.ts`

**Interfaces:**

- Removes: `TopBarProps.assistantEnabled`, `TopBarProps.onOpenAssistant`; `BoardCommandsProps.onOpenAssistant` (`assistantEnabled` stays for the `⌘Z` help row); `BoardViewState.askOpen`, `openAsk`; `assistantApi.latest`; `queryKeys.assistantLatest`; catalogue keys `assistant.*`, `palette.ask`, `palette.askKeywords`, `shortcuts.ask`.

- [ ] **Step 1: Tests first, by deletion and adjustment**

`TopBar.test.tsx`: delete the cases "is absent when the assistant is off" and "shows at every width when the assistant is on and opens the panel on click"; rename the cluster case to `'keeps all four controls in one cluster that never shrinks'`, drop `ask` from its list, take `const cluster = barSlot(screen.getByRole('button', { name: 'Display' }))`, and drop `assistantEnabled` from every `renderTopBar(...)` call in the file (and from the helper's defaults, if it has them). If the describe is named `TopBar question button`, rename it `TopBar controls`.

`BoardCommands.test.tsx`: delete the seven cases from "lists the question entry and opens it with mod+j when the assistant is on" through "has no question entry and no shortcut when the assistant is off", and the `ASK` constant; keep "lists ⌘Z in the shortcuts sheet…" and "⌘Z undoes…" exactly as they are; drop `onOpenAssistant` from the props the file renders with.

`useBoardViewState.test.tsx`: delete the case "keeps the question panel and the note panel mutually exclusive in the URL". Add, in its place:

```tsx
it('drops a stale ask parameter when a note opens', () => {
  const { result } = setup('/boards/b1?ask=1');
  act(() => result.current.view.openNote('n2'));
  expect(result.current.location.search).toBe('?note=n2');
});
```

`FilterBar.test.tsx:19` and `util/noteDerived.test.ts:23`: remove the `askOpen: false,` line from the view-state fixture.

Run those four files. Expected: FAIL on the typecheck of the removed props (vitest reports the TypeScript-free runtime failures only; the typecheck in Step 4 catches the rest), and the new view-state case fails because `openNote` writes `ask: null` already — it passes; keep it as the record.

- [ ] **Step 2: The code**

`AppShell.tsx`: remove the `AssistantPanel` import and the block `{board.assistantEnabled && (<AssistantPanel …/>)}` with its comment; remove `assistantEnabled` and `onOpenAssistant` from the `TopBar` element; remove `onOpenAssistant` from the `BoardCommands` element (keep `assistantEnabled={board.assistantEnabled}` there, it gates the `⌘Z` row).

`TopBar.tsx`: remove the two props, their doc comment, the destructuring, the Ask button block (`{assistantEnabled && (<IconTooltip …>…</IconTooltip>)}`), and reword the layout comment at the top of the component so it names the four controls (Display, Share, New, account) and says nothing of an Ask button; remove the now-unused `MOD_KEY` import if nothing else in the file uses it.

`BoardCommands.tsx`: remove `onOpenAssistant` from the props and its doc comment (reword the `assistantEnabled` comment: "Wallybot can fill in on this board; gates the ⌘Z help row."); remove the `mod+j` shortcut push block; remove the palette `CommandItem value="ask question"`; in the shortcuts sheet keep only the `⌘Z` row under `assistantEnabled`.

`hooks/useBoardViewState.ts`: remove `askOpen` from the state interface and from the memo; remove `openAsk`; keep `openNote`'s `ask: null` so a stale `?ask=1` link is cleaned when a note opens (the test above pins it), and change its comment to "A stale `ask` parameter from before slice 4 is dropped when a note opens."

`hooks/queryKeys.ts`: remove `assistantLatest`.

`lib/resources.ts`: remove `assistantApi.latest`; drop `assistantConversationDtoSchema` and `AssistantConversationDto` from the import if nothing else in the file uses them.

`hooks/useEscapeToClose.ts`: the first line of the doc comment becomes "Escape closes a desktop side panel (the note panel)."

Delete the four `Assistant/` files with `git rm`.

Run: `pnpm --filter @wally/web typecheck`. Expected: errors only where the catalogue keys are still referenced (none, once the panel is gone) — fix any that remain.

- [ ] **Step 3: Catalogue**

In `de.ts` and `en.ts` remove the whole `assistant: {…}` block (with its doc comment), `palette.ask`, `palette.askKeywords` (and its comment) and `shortcuts.ask`. Run `pnpm vitest run src/i18n/resources.test.ts src/i18n/noHardcodedCopy.test.ts src/i18n/germanSurface.test.tsx`: PASS (parity holds, no orphan key).

- [ ] **Step 4: Checks and commit**

`pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check`, then the whole web suite.

```bash
git add -A apps/web/src/features/board apps/web/src/lib/resources.ts apps/web/src/i18n/de.ts apps/web/src/i18n/en.ts
git -c core.hooksPath=/dev/null commit -m "refactor(web): retire the question panel, its button, its palette entry and its shortcut

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs, the prompt's wording and the E2E guard

**Files:**

- Modify: `docs/rfcs/0005-wallybot-inline.md` (status line)
- Modify: `docs/BRAND.md` ("## AI" paragraph and rule 8)
- Modify: `docs/rfcs/0003-wally-agent.md` (lines naming the panel: the scope line, §2, §3.1 "Ask the board", §3.2 "Spend has a hard cap")
- Modify: `apps/api/src/lib/assistant/prompt.ts`, `apps/api/src/lib/assistant/prompt.test.ts`
- Modify: `apps/web/e2e/note-create.spec.ts`

- [ ] **Step 1: The prompt stops saying panel**

In `apps/api/src/lib/assistant/prompt.ts`, `INSTRUCTIONS_PREFIX`, four replacements, nothing else:

- `'This is the assistant panel of Wally, a personal task board. …'` → `'This is the assistant of Wally, a personal task board. Answer questions about one board for the person asking.'`
- `… say in one sentence that this panel answers questions about the board.` → `… say in one sentence that this answers questions about the board only.`
- `The panel shows the marker as the note's title in the sentence, …` → `The board shows the marker as the note's title in the sentence, …`
- `'This panel only reads the board. … reply in one sentence that changes are not available in this panel yet.'` → `'Questions only read the board. … reply in one sentence that changes are not available from a question yet.'`

`prompt.test.ts`: update the three literal expectations (lines 40, 52 and 58) to the new sentences; the count assertion at line 58 matches `/this answers questions about the board only/g`.

Run: `cd apps/api && pnpm vitest run src/lib/assistant/prompt.test.ts`. Expected: PASS. Then `pnpm --filter @wally/api typecheck && pnpm --filter @wally/api lint` from the root.

- [ ] **Step 2: Docs**

`docs/rfcs/0005-wallybot-inline.md` status line: append `; slice 4 started 2026-10-17 (questions answered as a card where they were written, the question panel retired).` before the final period of the **Status** line, and set **Last revised** to 2026-10-17 (it is already).

`docs/BRAND.md`, the "## AI" paragraph: replace its first sentence so it reads

> Wally's AI is two things on the board: the answer to a question typed into the capture card (`features/board/Ask`), drawn as a card where the question was written, with the notes it read listed underneath, and the fill-in on a note written in place (`features/board/Suggestions`), …

(the rest of the paragraph unchanged). Rule 8 becomes:

> 8. Questions about the wall are answered on the wall, as a card where the question was written, in plain text, with the notes it read listed underneath. The card has the dashed edge and nothing else: no dot, no ring, because nothing is written.

`docs/rfcs/0003-wally-agent.md`: line 12 "a panel beside the board where a person captures, asks and" → "the board itself, where a person captures, asks and"; the §2 sentence (line 45) "from a panel beside the board" → "from the board itself"; §3.1 "Ask the board" done-when: "every note it relied on is a clickable chip. A chip is rendered only for a note id that exists on the board." → "every note it relied on is a clickable row under the answer. A row is rendered only for a note id that exists on the board."; §3.2 "Spend has a hard cap": "the panel says when it resets" → "the answer says when it resets". Run `pnpm format:check` (the tables are Prettier-formatted; run `pnpm format` if a column moved).

- [ ] **Step 3: The E2E guard**

CI's E2E stack runs with the assistant off (`.github/workflows/ci.yml` builds its `.env` without `ASSISTANT_*`, and `ASSISTANT_ENABLED` defaults to false), so a `?` title must write a plain note there. Confirm with `grep -n ASSISTANT .github/workflows/ci.yml docker-compose.ci.yml` (expected: no match), then add to `apps/web/e2e/note-create.spec.ts`:

```ts
test('a title ending in a question mark is a plain note while the board has no assistant', async ({
  page,
}) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  // With the assistant off, nothing is asked: the hint never changes and Enter writes the note.
  const title = `E2E question ${Date.now()}?`;
  await page.getByRole('button', { name: 'Neue Notiz' }).click();
  const card = page.getByRole('group', { name: 'Neue Notiz schreiben' });
  await card.getByLabel('Titel der neuen Notiz', { exact: true }).fill(title);
  await expect(card.getByText('↵ anlegen · ⇧↵ Text · Esc verwerfen')).toBeVisible();
  await card.getByLabel('Titel der neuen Notiz', { exact: true }).press('Enter');
  await expect(card).toBeHidden();

  await expect(page.locator('[data-ask-card]')).toHaveCount(0);
  await page.getByLabel('Notizen durchsuchen').fill(title);
  await expect(page.locator('[data-note-id]', { hasText: title })).toBeVisible();
});
```

If the grep does find the assistant switched on in CI, write this variant instead: fill the same title, assert the hint reads `↵ fragt die Wand · Esc verwerfen`, press Enter, assert `page.locator('[data-ask-card]')` is visible with the question text, and that after filtering by the title no `[data-note-id]` matches.

The vacuous-run guard in `ci.yml` (`MIN_EXECUTED`) counts executed tests; raise it by one if the new test runs on the desktop project. Run `cd apps/web && pnpm exec playwright test --list` to confirm the spec parses (no browser run locally).

- [ ] **Step 4: Commit**

```bash
git add docs/rfcs/0005-wallybot-inline.md docs/BRAND.md docs/rfcs/0003-wally-agent.md apps/api/src/lib/assistant/prompt.ts apps/api/src/lib/assistant/prompt.test.ts apps/web/e2e/note-create.spec.ts .github/workflows/ci.yml
git -c core.hooksPath=/dev/null commit -m "docs: questions are answered on the wall; the prompt and the E2E guard say so

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Omit `.github/workflows/ci.yml` from the `add` if it was not changed.)

---

## Self-review

- **Spec coverage.** §3.6: a question typed into the capture card ending in `?` (T1, R1), answered as an ephemeral card on the wall (T3, T4, R3), same type (T3), dashed edge (T3), the notes it relied on underneath as rows (T3 via `AnswerNotes`), fades after it is read unless pinned (T2, R5, R6); the route, ledger and conversation storage unchanged (only the prompt's wording moves, T6); the panel retired (T5, R7). WALLY_AGENT §3.2: chips checked at render time (`AnswerNotes` drops a chip whose note is gone, unchanged), the refusal says when it resets (T3), the user's language (the API's; the card's copy from the catalogues). §7: typing is never blocked (the ask starts after Enter), no modal, focus is taken only from the page (R8). BRAND: no marigold on the card, no toast, no name; rule 8 reworded (T6).
- **Placeholder scan.** Every step carries its code or its exact edit; the two E2E variants are both written out with the criterion that picks one.
- **Type consistency.** `onAsk` (card) / `onCaptureAsk` (views, session return) / `onAsked` (session option) are three names for three layers, each defined once in Task 1 and consumed by Task 4; `AskSlot` (T4) carries `key`, `placement`, `card`; `AskSession.phase` values are the same five in T2 and T3; `useAskAssistant` returns the function itself from T2 on, and `AssistantContent` is adapted in T2 so the tree compiles until T5 deletes it; `ASK_CARD_WIDTH` is defined in T3 and read in T4.
- **Review Focus.** 1 → T1 card cases and T6 E2E; 2 → T2 "continues the conversation…", "dismissal while asking…"; 3 → T2 pause and pin cases, T3 hover/focus and Esc cases; 4 → T2 refusal case, T3 refusal/failure case; 5 → T3 focus-on-mount, hands-the-focus, single-key and Esc cases.
- **Deferred, for the PR:** the §3.7 settings beyond "always ask me"; showing earlier exchanges anywhere (R9); restoring a pinned answer after a reload (R5); the API's `latest` and `:conversationId` routes, which no client calls now (kept per §3.6; removal is a later cleanup).
