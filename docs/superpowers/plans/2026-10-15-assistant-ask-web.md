# Ask the Board, Web Half: Implementation Plan

> **Status:** executed in PR #42, landed on `main` in PR #45.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A panel beside the board where a person types a question and reads the answer, plain text with the notes it relied on listed underneath, opened from the command palette, a shortcut and the top bar, hidden entirely when the assistant is off.

**Architecture:** One feature folder `apps/web/src/features/board/Assistant/` with the panel shell (desktop aside, mobile sheet, same as the note panel), its content (one ask field at the top, exchanges newest first), and the notes-read rows. Data goes through `assistantApi` in `lib/resources.ts` and two hooks: a query for the latest open conversation and a mutation for a turn, which keeps the question on screen while the answer loads and handles the API's three outcomes (answer, cap refused, conversation closed). The panel's open state is a URL param like the note panel's. Copy lives in the catalogues under `assistant`.

**Tech Stack:** React 19, react-router 8, TanStack Query 5, Radix (Sheet), Tailwind with the Graphite + Marigold tokens, react-i18next, Vitest + Testing Library. The API contract is `assistantTurnRequestSchema`, `assistantConversationDtoSchema` and `assistantTurnResponseSchema` from `@wally/shared` (previous plan, `2026-10-15-assistant-ask-api.md`).

**Spec:** `docs/rfcs/0003-wally-agent.md` at commit `38afd3cb` (read it at `/Users/mr_user/development/apps/wally-docs-rfc-agent/docs/rfcs/0003-wally-agent.md`), §3.1 "Ask the board" and §3.2. Design authority: `docs/BRAND.md` on this branch, especially "## AI", "Components", "Keyboard", "Voice". The project owner asked for a minimal, modern design, not a traditional chatbot.

## Design

What the panel is, in one sentence: a question field above a stack of answers, the newest on top, each answer plain text with the notes it read listed underneath as small rows that open the note. No bubbles, no avatars, no name, no icon, no typing indicator, no "send" ceremony.

- **Where it lives.** A 400 px aside on the right on desktop, exactly the note panel's frame (`absolute inset-y-0 right-0 z-drawer w-[400px] border-l border-border bg-surface shadow-e3 animate-slide-in-right`); below desktop a right `Sheet` with `hideClose`. Only one of the two panels is open at a time: opening the question panel closes the note, and opening a note from an answer closes the question panel. Its open state is the URL param `ask=1` (transient, like `note`).
- **Header.** Title "Fragen" / "Ask" at 16/600, a ghost "Neu" / "New" text button that starts a fresh conversation (hidden until there is one), and the same ghost icon close button the note panel uses. `aria-label` for the aside from the catalogue.
- **The field.** A `Textarea` (one to four lines, auto-grown by content), placeholder "Was ist heute offen?" / "What is open today?", focused when the panel opens on desktop. Enter asks, Shift+Enter breaks a line. A ghost icon button with `ArrowUp` at the field's end is the mouse and touch way to ask (lucide `ArrowUp` is not a banned icon). Disabled while a turn is running.
- **Empty state.** Three example questions as `outline` small buttons under the field; clicking one asks it. No illustration.
- **An exchange.** The question at 13/400 `text-fg-3`, then the answer at 14/400 `text-fg-1` with paragraphs preserved (`whitespace-pre-line`), then, when there are chips, the notes read as a list of compact rows: priority icon, title (13/500), due date in its status colour, the row opens the note. A partial answer carries one 12/400 `text-fg-3` line: "Nur ein Teil der passenden Notizen wurde gelesen." A stopped turn shows that line instead of an answer. Exchanges are separated by a hairline; the newest is first, so the field and the latest answer stay together at the top and nothing scrolls to the bottom.
- **Loading.** While a turn runs, the new question is already on screen at the top with two `Skeleton` lines (14 px tall, 90% and 60% wide) where the answer will be. No spinner.
- **Refusals.** Inline, in the slot the answer would take, in `text-fg-3`: daily cap with the reset time, monthly cap with the reset date, busy, timeout, tool limit, a generic failure. No toast and no modal (BRAND.md AI rule 5).
- **Closed conversation.** The API answers 409 when a conversation closed under the panel; the hook retries once without the conversation id and the panel shows the new conversation. The old one is not shown.
- **Off.** When `board.assistantEnabled` is false nothing exists: no palette entry, no shortcut, no top-bar button, and `?ask=1` renders nothing.
- **Entry points.** Command palette entry "Wand fragen…" / "Ask the wall…" under Actions; shortcut `mod+j` (listed in the `?` sheet); a ghost text button "Fragen" / "Ask" in the top bar next to the commands trigger, visible at every width (unlike the trigger, so phones can open the panel), with the shortcut in its tooltip.
- **Voice.** Sentence case, no exclamation marks, no name for the AI, no first person anywhere in the copy. German is informal du.

## Global Constraints

- Work only in `/Users/mr_user/development/apps/wally-assistant`, branch `feat/assistant-ask-web` (parent `feat/assistant-ask-api`). Never run git or edit files in `/Users/mr_user/development/apps/wally`.
- Web tests run on the host from the worktree and touch no emulator:

  ```bash
  cd /Users/mr_user/development/apps/wally-assistant/apps/web && pnpm vitest run <file>
  ```

  Run one file at a time while iterating. Never run any docker or docker compose command.

- Checks, from the worktree root: `pnpm --filter @wally/web typecheck`, `pnpm --filter @wally/web lint`, `pnpm --filter @wally/shared typecheck`, `pnpm format:check` (fix with `pnpm format`). The web guard tests must stay green: `src/brandGuards.test.ts`, `src/i18n/noHardcodedCopy.test.ts`, `src/i18n/resources.test.ts`, `src/i18n/englishSurface.test.tsx`.
- No new dependency. No API change: the web consumes the contract as the API half defined it.
- Every string a person can see or a screen reader can read comes from the catalogues (`de.ts` is the key authority; `en.ts` mirrors every key with the same placeholders). No literal copy in components.
- BRAND.md: no sparkle, wand, robot or brain icon; the AI has no name and no pronoun; marigold is not used in this panel (the board's "New note" is the screen's one accent); status colour only on the due-date text; radius 12 for the panel; motion 120–180 ms on transform and opacity only.
- Keyboard: `mod+j` opens the panel; single keys never fire while typing; Escape closes the desktop panel the way `useEscapeToClose` does for the note panel.
- Conventional Commits; never commit to `main`. Commit with `git -c core.hooksPath=/dev/null commit`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prettier: single quotes, trailing commas, width 100.

## Review Focus

1. Enter in the field asks and Shift+Enter inserts a line break; an empty or whitespace question never sends. Test in Task 2.
2. A chip row opens the note through `onOpenNote` and closes the question panel; a chip is rendered only from the API's `chips` list, never parsed from the answer text. Test in Task 2.
3. A 429 with `resetsAt` renders the cap copy with the formatted time in the answer slot, and the question stays visible; a 409 retries once without the conversation id and renders the new conversation. Tests in Tasks 1 and 2.
4. With `assistantEnabled: false`, the palette has no entry, `mod+j` does nothing, the top bar has no button, and `?ask=1` renders no panel. Test in Task 3.
5. Opening a note while the question panel is open closes the panel, and opening the panel closes an open note. Test in Task 3.

---

### Task 1: Contract access, query keys and the two hooks

**Files:**

- Modify: `apps/web/src/lib/resources.ts` (add `assistantApi`)
- Modify: `apps/web/src/features/board/hooks/queryKeys.ts` (add `assistantLatest`)
- Create: `apps/web/src/features/board/Assistant/useAssistantConversation.ts`
- Create: `apps/web/src/features/board/Assistant/useAskAssistant.ts`
- Test: `apps/web/src/features/board/Assistant/useAskAssistant.test.tsx`

**Interfaces:**

- Consumes: `api` from `@/lib/apiClient` (`get`, `post`), `ApiError` (`status`, `code`, `body`), `useQueryKeys`, the three shared schemas.
- Produces:

```ts
// resources.ts
export const assistantApi = {
  latest: (boardId: string): Promise<AssistantConversationDto> =>
    api.get(`/whiteboards/${boardId}/assistant/conversations/latest`, assistantConversationDtoSchema),
  turn: (boardId: string, body: AssistantTurnRequest): Promise<AssistantTurnResponse> =>
    api.post(`/whiteboards/${boardId}/assistant/turns`, assistantTurnRequestSchema.parse(body), assistantTurnResponseSchema),
};

// queryKeys.ts
assistantLatest: (boardId: string) => [...root, 'boards', boardId, 'assistant', 'latest'] as const,

// useAssistantConversation.ts
export function useAssistantConversation(boardId: string, enabled: boolean): UseQueryResult<AssistantConversationDto | null>;
// 404 resolves to null; any other error propagates.

// useAskAssistant.ts
export type AskOutcome =
  | { kind: 'answered'; conversation: AssistantConversationDto }
  | { kind: 'refused'; code: 'ASSISTANT_DAILY_CAP' | 'ASSISTANT_MONTHLY_CAP' | 'ASSISTANT_BUSY'; resetsAt: string | null }
  | { kind: 'failed' };
export function useAskAssistant(boardId: string): {
  ask: (message: string, conversationId: string | null) => Promise<AskOutcome>;
  isPending: boolean;
};
// Builds timeZone and today from the browser, retries once without conversationId on 409 ASSISTANT_CONVERSATION_CLOSED,
// writes the returned conversation into the assistantLatest cache, maps 429 to 'refused' and anything else to 'failed'.
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/board/Assistant/useAskAssistant.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/apiClient';
import { createTestQueryClient } from '@/test/renderWithProviders';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  assistantApi: { latest: vi.fn(), turn: vi.fn() },
}));

import { assistantApi } from '@/lib/resources';
import { scopedQueryKeys } from '../hooks/queryKeys';
import { useAskAssistant } from './useAskAssistant';

const conversation = (id: string) => ({
  id,
  boardId: 'b1',
  status: 'OPEN' as const,
  model: 'm',
  entries: [],
});

describe('useAskAssistant', () => {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  beforeEach(() => {
    vi.mocked(assistantApi.turn).mockReset();
    queryClient.clear();
  });

  it('sends the question with the browser date and zone and caches the conversation', async () => {
    vi.mocked(assistantApi.turn).mockResolvedValue({ conversation: conversation('c1') });
    const { result } = renderHook(() => useAskAssistant('b1'), { wrapper });
    let outcome;
    await act(async () => {
      outcome = await result.current.ask('Was ist offen?', null);
    });
    expect(outcome).toEqual({ kind: 'answered', conversation: conversation('c1') });
    const [boardId, body] = vi.mocked(assistantApi.turn).mock.calls[0]!;
    expect(boardId).toBe('b1');
    expect(body).toMatchObject({ message: 'Was ist offen?' });
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(body).not.toHaveProperty('conversationId');
    expect(queryClient.getQueryData(scopedQueryKeys(null).assistantLatest('b1'))).toEqual(
      conversation('c1'),
    );
  });

  it('retries once without the conversation id when the conversation closed', async () => {
    vi.mocked(assistantApi.turn)
      .mockRejectedValueOnce(new ApiError(409, { error: 'ASSISTANT_CONVERSATION_CLOSED' }))
      .mockResolvedValueOnce({ conversation: conversation('c2') });
    const { result } = renderHook(() => useAskAssistant('b1'), { wrapper });
    let outcome;
    await act(async () => {
      outcome = await result.current.ask('zwei', 'c1');
    });
    expect(outcome).toMatchObject({ kind: 'answered', conversation: { id: 'c2' } });
    expect(vi.mocked(assistantApi.turn).mock.calls[0]![1]).toMatchObject({ conversationId: 'c1' });
    expect(vi.mocked(assistantApi.turn).mock.calls[1]![1]).not.toHaveProperty('conversationId');
  });

  it('maps a cap refusal to a refused outcome with the reset time', async () => {
    vi.mocked(assistantApi.turn).mockRejectedValue(
      new ApiError(429, {
        error: 'ASSISTANT_DAILY_CAP',
        message: 'x',
        resetsAt: '2026-10-16T00:00:00.000Z',
      }),
    );
    const { result } = renderHook(() => useAskAssistant('b1'), { wrapper });
    let outcome;
    await act(async () => {
      outcome = await result.current.ask('eins', null);
    });
    expect(outcome).toEqual({
      kind: 'refused',
      code: 'ASSISTANT_DAILY_CAP',
      resetsAt: '2026-10-16T00:00:00.000Z',
    });
  });

  it('maps anything else to failed and exposes isPending while in flight', async () => {
    let release: (value: { conversation: ReturnType<typeof conversation> }) => void = () => {};
    vi.mocked(assistantApi.turn).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() => useAskAssistant('b1'), { wrapper });
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.ask('eins', null);
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    await act(async () => {
      release({ conversation: conversation('c3') });
      await pending;
    });
    expect(result.current.isPending).toBe(false);

    vi.mocked(assistantApi.turn).mockRejectedValueOnce(
      new ApiError(500, { error: 'INTERNAL_SERVER_ERROR' }),
    );
    let outcome;
    await act(async () => {
      outcome = await result.current.ask('zwei', null);
    });
    expect(outcome).toEqual({ kind: 'failed' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/mr_user/development/apps/wally-assistant/apps/web && pnpm vitest run src/features/board/Assistant/useAskAssistant.test.tsx`
Expected: FAIL, cannot find module `./useAskAssistant`.

- [ ] **Step 3: The resource and the key**

In `apps/web/src/lib/resources.ts`, import `assistantConversationDtoSchema`, `assistantTurnRequestSchema`, `assistantTurnResponseSchema` and the types `AssistantConversationDto`, `AssistantTurnRequest`, `AssistantTurnResponse` from `@wally/shared`, and add `assistantApi` from the Interfaces block after `notesApi`.

In `apps/web/src/features/board/hooks/queryKeys.ts`, add to the returned object:

```ts
    /** The latest open question-panel conversation on a board; null in the cache means none. */
    assistantLatest: (boardId: string) =>
      [...root, 'boards', boardId, 'assistant', 'latest'] as const,
```

- [ ] **Step 4: The hooks**

Create `apps/web/src/features/board/Assistant/useAssistantConversation.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import type { AssistantConversationDto } from '@wally/shared';
import { ApiError } from '@/lib/apiClient';
import { assistantApi } from '@/lib/resources';
import { useQueryKeys } from '../hooks/queryKeys';

/** The latest open conversation on this board, or null when there is none yet. */
export function useAssistantConversation(boardId: string, enabled: boolean) {
  const keys = useQueryKeys();
  return useQuery<AssistantConversationDto | null>({
    queryKey: keys.assistantLatest(boardId),
    queryFn: async () => {
      try {
        return await assistantApi.latest(boardId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled,
  });
}
```

Create `apps/web/src/features/board/Assistant/useAskAssistant.ts`:

```ts
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantConversationDto } from '@wally/shared';
import { ApiError } from '@/lib/apiClient';
import { assistantApi } from '@/lib/resources';
import { useQueryKeys } from '../hooks/queryKeys';

export type RefusalCode = 'ASSISTANT_DAILY_CAP' | 'ASSISTANT_MONTHLY_CAP' | 'ASSISTANT_BUSY';
export type AskOutcome =
  | { kind: 'answered'; conversation: AssistantConversationDto }
  | { kind: 'refused'; code: RefusalCode; resetsAt: string | null }
  | { kind: 'failed' };

const REFUSALS: RefusalCode[] = ['ASSISTANT_DAILY_CAP', 'ASSISTANT_MONTHLY_CAP', 'ASSISTANT_BUSY'];

/** Today in the browser's calendar, as the API expects it; not UTC, which is a day off at night. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * One question to the board. The API's three outcomes are returned as data, never thrown,
 * so the panel renders each in the answer's place. A conversation that closed under the
 * panel is retried once without its id, which starts a new one.
 */
export function useAskAssistant(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const [isPending, setPending] = useState(false);

  const ask = useCallback(
    async (message: string, conversationId: string | null): Promise<AskOutcome> => {
      const base = {
        message,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        today: localToday(),
      };
      setPending(true);
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
        queryClient.setQueryData(keys.assistantLatest(boardId), response.conversation);
        return { kind: 'answered', conversation: response.conversation };
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 429 &&
          (REFUSALS as string[]).includes(error.code ?? '')
        ) {
          const body = error.body as { resetsAt?: string | null } | undefined;
          return {
            kind: 'refused',
            code: error.code as RefusalCode,
            resetsAt: body?.resetsAt ?? null,
          };
        }
        return { kind: 'failed' };
      } finally {
        setPending(false);
      }
    },
    [boardId, keys, queryClient],
  );

  return { ask, isPending };
}
```

Check `ApiError`'s constructor signature in `apps/web/src/lib/apiClient.ts` (`(status, body, message?)`) and that `code` is read from `body.error`; the tests construct it that way.

- [ ] **Step 5: Run the test to verify it passes**

Run the command from Step 2. Expected: PASS, 4 tests.

- [ ] **Step 6: Checks and commit**

Run from the worktree root: `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check`. Expected: pass.

```bash
cd /Users/mr_user/development/apps/wally-assistant && git add apps/web/src/lib/resources.ts apps/web/src/features/board/hooks/queryKeys.ts apps/web/src/features/board/Assistant/useAssistantConversation.ts apps/web/src/features/board/Assistant/useAskAssistant.ts apps/web/src/features/board/Assistant/useAskAssistant.test.tsx && git -c core.hooksPath=/dev/null commit -m "feat(web): assistant resource, query key and the ask hooks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The panel

**Files:**

- Modify: `apps/web/src/i18n/de.ts`, `apps/web/src/i18n/en.ts` (new `assistant` block, `palette.ask`, `shortcuts.ask`)
- Create: `apps/web/src/features/board/Assistant/AssistantPanel.tsx`
- Create: `apps/web/src/features/board/Assistant/AssistantContent.tsx`
- Create: `apps/web/src/features/board/Assistant/AnswerNotes.tsx`
- Test: `apps/web/src/features/board/Assistant/AssistantContent.test.tsx`

**Interfaces:**

- Consumes: `useAssistantConversation`, `useAskAssistant` (Task 1); `useNotes(boardId)` for the notes-read rows' due date and priority (`NoteDto`); `PriorityIcon`, `dueInfo`, `dueToneClass`; `Textarea`, `Button`, `Skeleton`, `Sheet`, `SheetContent`, `IconTooltip`; `cn`.
- Produces:

```tsx
export function AssistantPanel(props: {
  open: boolean;
  boardId: string;
  isBelowDesktop: boolean;
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
}): JSX.Element | null;

// AssistantContent: the inside of the panel, usable on its own in tests
export function AssistantContent(props: {
  boardId: string;
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
  autoFocus: boolean;
}): JSX.Element;
```

Catalogue keys (German is the authority; English mirrors every key):

```ts
  assistant: {
    title: 'Fragen',
    panelAria: 'Fragen zur Wand',
    placeholder: 'Was ist heute offen?',
    ask: 'Fragen',
    newConversation: 'Neu',
    examples: {
      open: 'Was ist heute offen?',
      overdue: 'Was ist überfällig?',
      busiest: 'Wer hat die meisten offenen Notizen?',
    },
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
    earlier: 'Zuvor',
  },
```

plus `palette.ask: 'Wand fragen…'` and `shortcuts.ask: 'Wand fragen'`. English: title 'Ask', panelAria 'Ask about the wall', placeholder 'What is open today?', ask 'Ask', newConversation 'New', examples {open 'What is open today?', overdue 'What is overdue?', busiest 'Who has the most open notes?'}, notesRead 'Notes read', partial 'Only part of the matching notes was read.', stopped {TOOL_LIMIT 'Stopped after twelve reads. A narrower question helps.', TIMEOUT 'No answer within a minute. A narrower question helps.', LENGTH 'The answer was cut short.'}, limit {daily 'Daily limit reached. Available again from {{when}}.', monthly 'Monthly limit reached. Available again from {{when}}.', busy 'Busy right now. Try again in a moment.'}, failed 'No answer. Try again.', earlier 'Earlier', palette.ask 'Ask the wall…', shortcuts.ask 'Ask the wall'.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/board/Assistant/AssistantContent.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssistantConversationDto } from '@wally/shared';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  assistantApi: { latest: vi.fn(), turn: vi.fn() },
  notesApi: { list: vi.fn().mockResolvedValue([]) },
}));

import { ApiError } from '@/lib/apiClient';
import { assistantApi, notesApi } from '@/lib/resources';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { AssistantContent } from './AssistantContent';

const entry = (
  role: 'user' | 'assistant',
  text: string,
  extra: Partial<AssistantConversationDto['entries'][number]> = {},
) => ({
  role,
  text,
  chips: [],
  partial: false,
  stopped: null,
  at: '2026-10-15T10:00:00.000Z',
  ...extra,
});
const conversation = (
  entries: AssistantConversationDto['entries'],
  id = 'c1',
): AssistantConversationDto => ({
  id,
  boardId: 'b1',
  status: 'OPEN',
  model: 'm',
  entries,
});

function renderContent(overrides: Partial<Parameters<typeof AssistantContent>[0]> = {}) {
  const onOpenNote = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <AssistantContent
      boardId="b1"
      onClose={onClose}
      onOpenNote={onOpenNote}
      autoFocus={false}
      {...overrides}
    />,
  );
  return { onOpenNote, onClose };
}

describe('AssistantContent', () => {
  beforeEach(() => {
    vi.mocked(assistantApi.latest)
      .mockReset()
      .mockRejectedValue(new ApiError(404, { error: 'NOT_FOUND' }));
    vi.mocked(assistantApi.turn).mockReset();
    vi.mocked(notesApi.list).mockResolvedValue([]);
  });

  it('shows the field and three example questions when there is no conversation', async () => {
    renderContent();
    expect(await screen.findByPlaceholderText('Was ist heute offen?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Was ist überfällig?' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Wer hat die meisten offenen Notizen?' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Zuvor')).not.toBeInTheDocument();
  });

  it('asks on Enter, keeps the question on screen while loading, then shows the answer with the notes read', async () => {
    const note = makeNote({ id: 'n1', title: 'Müller anrufen', dueDate: null });
    vi.mocked(notesApi.list).mockResolvedValue([note]);
    let release: (v: { conversation: AssistantConversationDto }) => void = () => {};
    vi.mocked(assistantApi.turn).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { onOpenNote } = renderContent();
    const user = userEvent.setup();
    const field = await screen.findByPlaceholderText('Was ist heute offen?');
    await user.type(field, 'Was ist offen?{Enter}');
    expect(screen.getByText('Was ist offen?')).toBeInTheDocument();
    expect(field).toBeDisabled();
    release({
      conversation: conversation([
        entry('user', 'Was ist offen?'),
        entry('assistant', 'Eine Notiz: Müller anrufen.', {
          chips: [{ id: 'n1', title: 'Müller anrufen' }],
        }),
      ]),
    });
    expect(await screen.findByText('Eine Notiz: Müller anrufen.')).toBeInTheDocument();
    expect(screen.getByText('Gelesene Notizen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Müller anrufen/ }));
    expect(onOpenNote).toHaveBeenCalledWith('n1');
    expect(field).not.toBeDisabled();
    expect(field).toHaveValue('');
  });

  it('inserts a line break on Shift+Enter and never sends an empty question', async () => {
    renderContent();
    const user = userEvent.setup();
    const field = await screen.findByPlaceholderText('Was ist heute offen?');
    await user.type(field, 'a{Shift>}{Enter}{/Shift}b');
    expect(field).toHaveValue('a\nb');
    expect(assistantApi.turn).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, '   {Enter}');
    expect(assistantApi.turn).not.toHaveBeenCalled();
  });

  it('asks an example question on click', async () => {
    vi.mocked(assistantApi.turn).mockResolvedValue({
      conversation: conversation([
        entry('user', 'Was ist überfällig?'),
        entry('assistant', 'Nichts.'),
      ]),
    });
    renderContent();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Was ist überfällig?' }));
    expect(await screen.findByText('Nichts.')).toBeInTheDocument();
    expect(vi.mocked(assistantApi.turn).mock.calls[0]![1]).toMatchObject({
      message: 'Was ist überfällig?',
    });
  });

  it('shows the newest exchange first and the rest under "Zuvor"', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(
      conversation([
        entry('user', 'eins'),
        entry('assistant', 'Antwort eins'),
        entry('user', 'zwei'),
        entry('assistant', 'Antwort zwei'),
      ]),
    );
    renderContent();
    expect(await screen.findByText('Antwort zwei')).toBeInTheDocument();
    const texts = screen.getAllByText(/Antwort (eins|zwei)/).map((el) => el.textContent);
    expect(texts).toEqual(['Antwort zwei', 'Antwort eins']);
    expect(screen.getByText('Zuvor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu' })).toBeInTheDocument();
  });

  it('renders a cap refusal in the answer slot with the reset time, and keeps the question', async () => {
    vi.mocked(assistantApi.turn).mockRejectedValue(
      new ApiError(429, {
        error: 'ASSISTANT_DAILY_CAP',
        message: 'x',
        resetsAt: '2026-10-16T00:00:00.000Z',
      }),
    );
    renderContent();
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText('Was ist heute offen?'), 'eins{Enter}');
    expect(
      await screen.findByText(/Tageslimit erreicht\. Ab .+ wieder verfügbar\./),
    ).toBeInTheDocument();
    expect(screen.getByText('eins')).toBeInTheDocument();
  });

  it('renders stopped and partial answers with their one line', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(
      conversation([
        entry('user', 'alles'),
        entry('assistant', 'Viele.', { partial: true }),
        entry('user', 'zu viel'),
        entry('assistant', '', { stopped: 'TOOL_LIMIT' }),
      ]),
    );
    renderContent();
    expect(await screen.findByText(/Nach zwölf Lesevorgängen gestoppt/)).toBeInTheDocument();
    expect(
      screen.getByText('Nur ein Teil der passenden Notizen wurde gelesen.'),
    ).toBeInTheDocument();
  });

  it('starts a fresh conversation on "Neu"', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(
      conversation([entry('user', 'eins'), entry('assistant', 'Antwort eins')]),
    );
    vi.mocked(assistantApi.turn).mockResolvedValue({
      conversation: conversation([entry('user', 'zwei'), entry('assistant', 'Antwort zwei')], 'c2'),
    });
    renderContent();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Neu' }));
    await waitFor(() => expect(screen.queryByText('Antwort eins')).not.toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Was ist heute offen?'), 'zwei{Enter}');
    expect(await screen.findByText('Antwort zwei')).toBeInTheDocument();
    expect(vi.mocked(assistantApi.turn).mock.calls[0]![1]).not.toHaveProperty('conversationId');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/mr_user/development/apps/wally-assistant/apps/web && pnpm vitest run src/features/board/Assistant/AssistantContent.test.tsx`
Expected: FAIL, cannot find module `./AssistantContent`.

- [ ] **Step 3: The copy**

Add the `assistant` block from the Interfaces section to `de.ts` (after `note`) and its English mirror to `en.ts`, and add `ask` to both `palette` and `shortcuts` blocks in both catalogues. Run `pnpm vitest run src/i18n/resources.test.ts` to confirm the catalogues still mirror each other.

- [ ] **Step 4: The notes-read rows**

Create `apps/web/src/features/board/Assistant/AnswerNotes.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { AssistantChip, NoteDto } from '@wally/shared';
import { cn } from '@/lib/cn';
import { PriorityIcon } from '../PriorityIcon';
import { dueInfo, dueToneClass } from '../util/noteDerived';

/**
 * The notes an answer relied on, listed underneath it (BRAND.md AI rule 8). The chips come
 * from the API and are never parsed out of the answer text; the board's own notes query
 * supplies priority and due date when it knows the note, so the rows read like the list.
 */
export function AnswerNotes({
  chips,
  notes,
  onOpenNote,
}: {
  chips: AssistantChip[];
  notes: NoteDto[];
  onOpenNote: (noteId: string) => void;
}) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-12 font-medium text-fg-3">{t('assistant.notesRead')}</p>
      <ul className="overflow-hidden rounded-lg border border-border">
        {chips.map((chip) => {
          const note = notes.find((n) => n.id === chip.id);
          const due = note ? dueInfo(note, t) : null;
          return (
            <li key={chip.id} className="border-b border-border-subtle last:border-b-0">
              <button
                type="button"
                onClick={() => onOpenNote(chip.id)}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left',
                  'transition-colors duration-120 hover:bg-surface-alt',
                  'focus-visible:bg-surface-alt focus-visible:outline-none',
                  '[@media(pointer:coarse)]:min-h-11',
                )}
              >
                {note && <PriorityIcon priority={note.priority} className="shrink-0 text-fg-3" />}
                <span className="min-w-0 flex-1 truncate text-13 font-medium text-fg-1">
                  {chip.title}
                </span>
                {due && (
                  <span className={cn('shrink-0 text-12', dueToneClass[due.tone])}>
                    {due.label}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

Check `PriorityIcon`'s props in `apps/web/src/features/board/PriorityIcon.tsx` (`priority`, `size`, `className`, `label`) and `dueInfo`'s `t` parameter type in `util/noteDerived.ts`; adjust the call if the signature differs and say so.

- [ ] **Step 5: The content**

Create `apps/web/src/features/board/Assistant/AssistantContent.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, X } from 'lucide-react';
import type { AssistantConversationDto, AssistantEntry } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { IconTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { useNotes } from '../hooks/useNotes';
import { AnswerNotes } from './AnswerNotes';
import { useAskAssistant, type AskOutcome } from './useAskAssistant';
import { useAssistantConversation } from './useAssistantConversation';

const EXAMPLES = ['open', 'overdue', 'busiest'] as const;

interface Exchange {
  question: string;
  answer: AssistantEntry | null;
  outcome: Exclude<AskOutcome, { kind: 'answered' }> | null;
}

/** Pairs the stored entries into exchanges, newest first. */
function exchangesOf(conversation: AssistantConversationDto | null | undefined): Exchange[] {
  if (!conversation) return [];
  const out: Exchange[] = [];
  const { entries } = conversation;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.role !== 'user') continue;
    const next = entries[i + 1];
    out.push({
      question: e.text,
      answer: next && next.role === 'assistant' ? next : null,
      outcome: null,
    });
  }
  return out.reverse();
}

function formatWhen(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function AssistantContent({
  boardId,
  onClose,
  onOpenNote,
  autoFocus,
}: {
  boardId: string;
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
  autoFocus: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data: stored } = useAssistantConversation(boardId, true);
  const { data: notes } = useNotes(boardId);
  const { ask, isPending } = useAskAssistant(boardId);
  const [draft, setDraft] = useState('');
  const [fresh, setFresh] = useState(false);
  const [pending, setPending] = useState<Exchange | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) fieldRef.current?.focus();
  }, [autoFocus]);

  const conversation = fresh ? null : (stored ?? null);
  const exchanges = useMemo(() => exchangesOf(conversation), [conversation]);

  async function submit(text: string) {
    const message = text.trim();
    if (!message || isPending) return;
    setDraft('');
    setPending({ question: message, answer: null, outcome: null });
    const outcome = await ask(message, conversation?.id ?? null);
    if (outcome.kind === 'answered') {
      setFresh(false);
      setPending(null);
    } else {
      setPending({ question: message, answer: null, outcome });
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit(draft);
    }
  }

  const [latest, ...earlier] = pending ? [pending, ...exchanges] : exchanges;
  const showNew = Boolean(conversation) && !pending;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="flex-1 text-16 font-semibold text-fg-1">{t('assistant.title')}</h2>
        {showNew && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFresh(true);
              setPending(null);
              fieldRef.current?.focus();
            }}
          >
            {t('assistant.newConversation')}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('common.close')}>
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="relative">
          <Textarea
            ref={fieldRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('assistant.placeholder')}
            rows={1}
            disabled={isPending}
            aria-label={t('assistant.ask')}
            className="min-h-9 max-h-28 pr-9"
          />
          <IconTooltip label={t('assistant.ask')} shortcut={['↵']}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void submit(draft)}
              disabled={isPending || !draft.trim()}
              aria-label={t('assistant.ask')}
              className="absolute bottom-1 right-1"
            >
              <ArrowUp />
            </Button>
          </IconTooltip>
        </div>

        {!latest && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {EXAMPLES.map((key) => (
              <Button
                key={key}
                variant="outline"
                size="sm"
                onClick={() => void submit(t(`assistant.examples.${key}`))}
              >
                {t(`assistant.examples.${key}`)}
              </Button>
            ))}
          </div>
        )}

        {latest && (
          <ExchangeView
            exchange={latest}
            notes={notes ?? []}
            onOpenNote={onOpenNote}
            locale={i18n.language}
            loading={pending !== null && pending.outcome === null}
          />
        )}

        {earlier.length > 0 && (
          <section className="mt-6">
            <p className="mb-2 text-12 font-medium text-fg-3">{t('assistant.earlier')}</p>
            {earlier.map((exchange, index) => (
              <div key={index} className={cn('border-t border-border-subtle py-3', 'opacity-80')}>
                <ExchangeView
                  exchange={exchange}
                  notes={notes ?? []}
                  onOpenNote={onOpenNote}
                  locale={i18n.language}
                  loading={false}
                />
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function ExchangeView({
  exchange,
  notes,
  onOpenNote,
  locale,
  loading,
}: {
  exchange: Exchange;
  notes: Parameters<typeof AnswerNotes>[0]['notes'];
  onOpenNote: (noteId: string) => void;
  locale: string;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const { answer, outcome } = exchange;
  return (
    <div className="mt-4">
      <p className="text-13 text-fg-3">{exchange.question}</p>
      {loading && (
        <div className="mt-2 flex flex-col gap-2" aria-busy>
          <Skeleton className="h-3.5 w-[90%]" />
          <Skeleton className="h-3.5 w-[60%]" />
        </div>
      )}
      {outcome && (
        <p className="mt-2 text-13 text-fg-3">
          {outcome.kind === 'failed'
            ? t('assistant.failed')
            : outcome.code === 'ASSISTANT_BUSY' || !outcome.resetsAt
              ? t('assistant.limit.busy')
              : t(
                  outcome.code === 'ASSISTANT_DAILY_CAP'
                    ? 'assistant.limit.daily'
                    : 'assistant.limit.monthly',
                  {
                    when: formatWhen(outcome.resetsAt, locale),
                  },
                )}
        </p>
      )}
      {answer && (
        <>
          {answer.text && (
            <p className="mt-2 whitespace-pre-line text-14 text-fg-1">{answer.text}</p>
          )}
          {answer.stopped && (
            <p className="mt-2 text-12 text-fg-3">{t(`assistant.stopped.${answer.stopped}`)}</p>
          )}
          {answer.partial && <p className="mt-1 text-12 text-fg-3">{t('assistant.partial')}</p>}
          <AnswerNotes chips={answer.chips} notes={notes} onOpenNote={onOpenNote} />
        </>
      )}
    </div>
  );
}
```

Points to settle while implementing, each stated in the report: whether `common.close` exists in the catalogue (use the note panel's close key if it does not, or add `assistant.closeAria`); the `t()` call with a template key (`assistant.examples.${key}`) may need `as const` typing against `ParseKeys`; the `IconTooltip` wrapping a disabled button (Radix tooltips need an enabled trigger; wrap the button in a `span` if needed). The test IDs the field by its placeholder, the rows by their title, the example and New buttons by their text.

- [ ] **Step 6: The panel shell**

Create `apps/web/src/features/board/Assistant/AssistantPanel.tsx`:

```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { AssistantContent } from './AssistantContent';

/** Escape closes the desktop panel unless a Radix layer is open above it; same rule as the note panel. */
function useEscapeToClose(onClose: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        document.querySelector(
          '[data-radix-popper-content-wrapper], [role="alertdialog"], [role="dialog"]',
        )
      )
        return;
      onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onClose]);
}

export function AssistantPanel({
  open,
  boardId,
  isBelowDesktop,
  onClose,
  onOpenNote,
}: {
  open: boolean;
  boardId: string;
  isBelowDesktop: boolean;
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
}) {
  const { t } = useTranslation();
  useEscapeToClose(onClose, open && !isBelowDesktop);

  if (isBelowDesktop) {
    return (
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        <SheetContent side="right" className="w-full max-w-sm p-0" hideClose>
          {open && (
            <AssistantContent
              boardId={boardId}
              onClose={onClose}
              onOpenNote={onOpenNote}
              autoFocus={false}
            />
          )}
        </SheetContent>
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <aside
      role="complementary"
      aria-label={t('assistant.panelAria')}
      className="absolute inset-y-0 right-0 z-drawer flex w-[400px] max-w-full animate-slide-in-right flex-col border-l border-border bg-surface shadow-e3"
    >
      <AssistantContent boardId={boardId} onClose={onClose} onOpenNote={onOpenNote} autoFocus />
    </aside>
  );
}
```

If the note panel's `useEscapeToClose` can be exported from `NoteDetailPanel.tsx` without churn, export and reuse it instead of copying; otherwise keep the copy and say so.

- [ ] **Step 7: Run the tests to verify they pass**

Run the command from Step 2 → PASS, 8 tests. Then run the guard tests one file at a time: `src/i18n/resources.test.ts`, `src/i18n/noHardcodedCopy.test.ts`, `src/brandGuards.test.ts`, `src/i18n/englishSurface.test.tsx` → PASS.

- [ ] **Step 8: Checks and commit**

Run from the worktree root: `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check`. Expected: pass.

```bash
cd /Users/mr_user/development/apps/wally-assistant && git add apps/web/src/i18n/de.ts apps/web/src/i18n/en.ts apps/web/src/features/board/Assistant/AssistantPanel.tsx apps/web/src/features/board/Assistant/AssistantContent.tsx apps/web/src/features/board/Assistant/AnswerNotes.tsx apps/web/src/features/board/Assistant/AssistantContent.test.tsx && git -c core.hooksPath=/dev/null commit -m "feat(web): the question panel with answers and the notes read" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Wiring: URL state, entry points, and the brand note

**Files:**

- Modify: `apps/web/src/features/board/hooks/useBoardViewState.ts` (`askOpen`, `openAsk`)
- Modify: `apps/web/src/features/board/AppShell.tsx` (mount the panel; mutual exclusion with the note panel)
- Modify: `apps/web/src/features/board/TopBar.tsx` (the "Fragen" button)
- Modify: `apps/web/src/features/board/BoardCommands.tsx` (palette entry, `mod+j`, help row)
- Modify: `apps/web/src/lib/shortcuts.ts` (`'assistant'` open request)
- Modify: `docs/BRAND.md` ("## AI" first paragraph)
- Test: `apps/web/src/features/board/BoardCommands.test.tsx` (two cases), `apps/web/src/features/board/hooks/useBoardViewState.test.tsx` (one case)

**Interfaces:**

- Consumes: `AssistantPanel` (Task 2), `requestOpen`/`useOpenRequest`, `useKeyboardShortcuts`, `board.assistantEnabled`.
- Produces: `BoardViewState.askOpen: boolean`; `openAsk(open: boolean)` on the view-state hook's return, which also clears `note` when opening; `openNote(id)` clears `ask` when opening a note. `requestOpen('assistant')`. `BoardCommands` gains `assistantEnabled: boolean` and `onOpenAssistant: () => void`; `TopBar` gains the same two props.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/features/board/hooks/useBoardViewState.test.tsx`, add (following the file's existing render helper for the hook):

```tsx
it('keeps the question panel and the note panel mutually exclusive in the URL', () => {
  const { result, location } = renderViewState('/boards/b1?note=n1');
  act(() => result.current.openAsk(true));
  expect(location().search).toBe('?ask=1');
  expect(result.current.askOpen).toBe(true);
  expect(result.current.noteId).toBeNull();
  act(() => result.current.openNote('n2'));
  expect(location().search).toBe('?note=n2');
  expect(result.current.askOpen).toBe(false);
  act(() => result.current.openAsk(false));
  expect(location().search).toBe('?note=n2');
});
```

Adapt `renderViewState` and `location()` to whatever helpers the file already uses to render the hook inside a router and read the current location; the assertions are what must hold.

In `apps/web/src/features/board/BoardCommands.test.tsx`, extend `renderCommands` with `assistantEnabled` (default `true`) and `onOpenAssistant: vi.fn()` props, then add:

```tsx
it('lists the question entry and opens it with mod+j when the assistant is on', async () => {
  const { onOpenAssistant } = renderCommands({ assistantEnabled: true });
  const user = userEvent.setup();
  await user.keyboard(PALETTE);
  await user.click(await screen.findByText('Wand fragen…'));
  expect(onOpenAssistant).toHaveBeenCalledTimes(1);
  await user.keyboard(isMac ? '{Meta>}j{/Meta}' : '{Control>}j{/Control}');
  expect(onOpenAssistant).toHaveBeenCalledTimes(2);
});

it('has no question entry and no shortcut when the assistant is off', async () => {
  const { onOpenAssistant } = renderCommands({ assistantEnabled: false });
  const user = userEvent.setup();
  await user.keyboard(PALETTE);
  expect(screen.queryByText('Wand fragen…')).not.toBeInTheDocument();
  await user.keyboard('{Escape}');
  await user.keyboard(isMac ? '{Meta>}j{/Meta}' : '{Control>}j{/Control}');
  expect(onOpenAssistant).not.toHaveBeenCalled();
});
```

(`renderCommands` must return the `onOpenAssistant` mock alongside the others.)

- [ ] **Step 2: Run the tests to verify they fail**

`pnpm vitest run src/features/board/hooks/useBoardViewState.test.tsx` → FAIL (`openAsk` is not a function). `pnpm vitest run src/features/board/BoardCommands.test.tsx` → FAIL (no entry).

- [ ] **Step 3: URL state**

In `useBoardViewState.ts`: add `askOpen: boolean` to `BoardViewState`, read it as `searchParams.get('ask') === '1'`, and add to the returned object:

```ts
    /** The question panel. Opening it closes the note; opening a note closes it. */
    openAsk: (open: boolean) => setParams(open ? { ask: '1', note: null } : { ask: null }, 'push'),
```

and change `openNote` so that opening a note (a non-null id) also sends `ask: null` in the same `setParams` call.

- [ ] **Step 4: Shell and top bar**

In `apps/web/src/lib/shortcuts.ts`, extend `type OpenRequest = 'palette' | 'shortcuts' | 'share' | 'assistant';`.

In `AppShell.tsx`: import `AssistantPanel`; render it right after `NoteDetailPanel` inside the same relative container:

```tsx
{
  board.assistantEnabled && (
    <AssistantPanel
      open={viewState.askOpen}
      boardId={boardId}
      isBelowDesktop={isBelowDesktop}
      onClose={() => viewState.openAsk(false)}
      onOpenNote={viewState.openNote}
    />
  );
}
```

Pass `assistantEnabled={board.assistantEnabled}` and `onOpenAssistant={() => viewState.openAsk(true)}` to both `TopBar` and `BoardCommands`.

In `TopBar.tsx`: add the two props to `TopBarProps`; next to the commands trigger add, only when `assistantEnabled`:

```tsx
{
  assistantEnabled && (
    <IconTooltip label={t('shortcuts.ask')} shortcut={[MOD_KEY, 'J']}>
      <Button variant="ghost" onClick={onOpenAssistant} className="hidden text-fg-3 md:inline-flex">
        {t('assistant.ask')}
      </Button>
    </IconTooltip>
  );
}
```

- [ ] **Step 5: Palette, shortcut and help**

In `BoardCommands.tsx`: add the two props; `useOpenRequest('assistant', onOpenAssistant)`; add to `shortcuts` only when `assistantEnabled`: `{ keys: 'mod+j', handler: (e) => { e.preventDefault(); onOpenAssistant(); }, allowInInputs: true }`; add to the Actions group, only when `assistantEnabled`, a `CommandItem` with `value="ask question wand fragen"` whose `onSelect` runs `onOpenAssistant` through the same `run(...)` helper the others use, showing `t('palette.ask')` and no icon; add to the help `rows`, only when `assistantEnabled`, `{ keys: [MOD_KEY, 'J'], label: t('shortcuts.ask') }`.

- [ ] **Step 6: The brand note**

In `docs/BRAND.md`, replace the first paragraph of "## AI" ("Wally has no AI today: …") with:

```markdown
Wally's AI is the question panel beside the board (`features/board/Assistant`): it answers
questions about the wall from the notes it reads and nothing else yet. These rules are the
contract it follows, and `brandGuards.test.ts` enforces the first one.
```

Keep the quote and the eight rules unchanged.

- [ ] **Step 7: Run the tests and the guards**

`pnpm vitest run src/features/board/hooks/useBoardViewState.test.tsx` → PASS. `pnpm vitest run src/features/board/BoardCommands.test.tsx` → PASS. Then, one at a time: `src/features/board/Assistant/AssistantContent.test.tsx`, `src/i18n/resources.test.ts`, `src/i18n/noHardcodedCopy.test.ts`, `src/brandGuards.test.ts`, `src/i18n/englishSurface.test.tsx`, `src/features/board/ListView/ListView.test.tsx` → PASS.

- [ ] **Step 8: Checks and commit**

Run from the worktree root: `pnpm --filter @wally/web typecheck && pnpm --filter @wally/web lint && pnpm format:check`. Expected: pass.

```bash
cd /Users/mr_user/development/apps/wally-assistant && git add apps/web/src/features/board/hooks/useBoardViewState.ts apps/web/src/features/board/hooks/useBoardViewState.test.tsx apps/web/src/features/board/AppShell.tsx apps/web/src/features/board/TopBar.tsx apps/web/src/features/board/BoardCommands.tsx apps/web/src/features/board/BoardCommands.test.tsx apps/web/src/lib/shortcuts.ts docs/BRAND.md && git -c core.hooksPath=/dev/null commit -m "feat(web): open the question panel from the palette, mod+j and the top bar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** §3.1 "Ask the board": the panel, the answer from the live board, chips that open the note (Tasks 1–3). §3.2 "It can be switched off" web half: nothing rendered when the flag is false (Task 3). "Spend has a hard cap": the refusal copy with the reset time (Task 2). "Answers say when they are partial" and "Runaway turns stop": the one-line copy for `partial` and `stopped` (Task 2). "It speaks the user's language": the catalogues. BRAND.md AI rules: no icon, no name, no pronoun, plain text with the notes listed underneath, no toast or modal.
- **Placeholder scan.** Each step has its code or exact command. The three points to settle in Task 2 Step 5 name the file and symbol to check.
- **Type consistency.** `AskOutcome` (Task 1) is what `AssistantContent` branches on (Task 2); `AssistantEntry` and `AssistantChip` come from the shared contract; `openAsk`/`askOpen` (Task 3) are the names `AppShell` uses.
- **Review Focus.** 1: Task 2 "Shift+Enter" test. 2: Task 2 answer test (click calls `onOpenNote`; chips come from the DTO). 3: Task 1 cap and 409 tests, Task 2 cap rendering. 4: Task 3 palette tests; the shell's `assistantEnabled` guard is reviewed in the diff. 5: Task 3 view-state test.
