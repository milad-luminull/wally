import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { SuggestionDto } from '@wally/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  assistantApi: { suggest: vi.fn(), decide: vi.fn(), pendingSuggestions: vi.fn() },
}));
const wallybot = { autoApply: true };
vi.mock('@/lib/preferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/preferences')>()),
  useWallybotPreferences: () => [wallybot, vi.fn()] as const,
}));

import { assistantApi } from '@/lib/resources';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { scopedQueryKeys } from '../hooks/queryKeys';
import { COUNTDOWN_MS, KEEP_RETRY_MS, UNDO_WINDOW_MS, useSuggestions } from './useSuggestions';
import { PendingDot } from './PendingDot';
import { proposedTitle } from './pendingProps';

const BOARD = 'board-1';
const dto = (over: Partial<SuggestionDto> = {}): SuggestionDto => ({
  id: 's1',
  boardId: BOARD,
  noteId: 'n1',
  status: 'PENDING',
  baseRevision: 3,
  fields: {
    dueDate: { value: '2026-10-23', reason: 'Friday' },
    priority: { value: 'HOCH', reason: 'urgent' },
    assignee: null,
    title: null,
    reference: null,
    subtasks: null,
    links: null,
  },
  typed: [],
  kept: null,
  createdAt: '2026-10-17T10:00:00.000Z',
  ...over,
});

/** The signed-in person in these tests. */
const ME = 'me';
const person = (id: string) => ({ id, email: `${id}@example.com`, displayName: id });

function setup(enabled = true, queryClient = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useSuggestions(BOARD, enabled, ME), { wrapper }) };
}

/** A decision the test answers by hand, to act while it is on its way. */
function holdDecide() {
  let answer: (() => void) | null = null;
  vi.mocked(assistantApi.decide).mockImplementationOnce(
    (_b, id, body) =>
      new Promise((resolve) => {
        answer = () =>
          resolve({
            suggestion: dto({
              id,
              status:
                body.decision === 'keep'
                  ? 'KEPT'
                  : body.decision === 'undo'
                    ? 'UNDONE'
                    : 'DISCARDED',
              kept:
                body.decision === 'keep'
                  ? { fields: body.fields ?? [], subtasks: [], links: [], revision: 5 }
                  : null,
            }),
          });
      }),
  );
  return async () => {
    await act(async () => {
      answer?.();
      await vi.advanceTimersByTimeAsync(0);
    });
  };
}

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

const PENDING_KEY = scopedQueryKeys(null).assistantPending(BOARD);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  wallybot.autoApply = true;
  vi.mocked(assistantApi.pendingSuggestions).mockResolvedValue({ suggestions: [] });
  vi.mocked(assistantApi.suggest).mockResolvedValue({ suggestion: dto() });
  vi.mocked(assistantApi.decide).mockImplementation(async (_b, id, body) => ({
    suggestion: dto({
      id,
      status: body.decision === 'keep' ? 'KEPT' : body.decision === 'undo' ? 'UNDONE' : 'DISCARDED',
      kept:
        body.decision === 'keep'
          ? {
              fields: body.fields ?? ['dueDate', 'priority'],
              subtasks: [],
              links: [],
              revision: 5,
            }
          : null,
    }),
  }));
});
afterEach(() => vi.useRealTimers());

describe('useSuggestions', () => {
  it('asks after a commit, shows the proposal, and keeps it when the countdown ends', async () => {
    const { result } = setup();
    act(() => result.current.request('n1', ['assignee']));
    expect(result.current.marks.get('n1')?.phase).toBe('asking');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(assistantApi.suggest).toHaveBeenCalledWith(BOARD, {
      noteId: 'n1',
      locked: ['assignee'],
      timeZone: expect.any(String),
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    const mark = result.current.marks.get('n1')!;
    expect(mark.phase).toBe('pending');
    expect(mark.fields).toEqual(['dueDate', 'priority']);
    expect(mark.countdownEndsAt).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    });
    expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
      decision: 'keep',
      fields: ['dueDate', 'priority'],
      source: 'countdown',
    });
    expect(result.current.marks.get('n1')?.phase).toBe('kept');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    });
    expect(result.current.marks.has('n1')).toBe(false);
  });

  it('pauses the countdown while hovered or focused, and resumes where it was', async () => {
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    act(() => result.current.setPaused('n1', true));
    expect(result.current.marks.get('n1')?.paused).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
    });
    expect(assistantApi.decide).not.toHaveBeenCalled();
    act(() => result.current.setPaused('n1', false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS - 2000 - 10);
    });
    expect(assistantApi.decide).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(assistantApi.decide).toHaveBeenCalledTimes(1);
  });

  it('runs no countdown when the person always wants to be asked; Enter keeps', async () => {
    wallybot.autoApply = false;
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 3);
    });
    expect(result.current.marks.get('n1')?.countdownEndsAt).toBeNull();
    expect(assistantApi.decide).not.toHaveBeenCalled();
    act(() => result.current.keep('n1', 'enter'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(assistantApi.decide).toHaveBeenCalledWith(
      BOARD,
      's1',
      expect.objectContaining({ source: 'enter' }),
    );
  });

  it('removes a field before keeping, and discards when the last one goes', async () => {
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.remove('n1', 'priority'));
    expect(result.current.marks.get('n1')?.fields).toEqual(['dueDate']);
    act(() => result.current.keep('n1', 'enter'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(assistantApi.decide).toHaveBeenLastCalledWith(BOARD, 's1', {
      decision: 'keep',
      fields: ['dueDate'],
      source: 'enter',
    });
    vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
      suggestion: dto({ id: 's2', noteId: 'n2' }),
    });
    act(() => result.current.request('n2', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.remove('n2', 'dueDate'));
    act(() => result.current.remove('n2', 'priority'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Taken apart field by field: the record says the last × did it, not Esc.
    expect(assistantApi.decide).toHaveBeenLastCalledWith(BOARD, 's2', {
      decision: 'discard',
      source: 'remove',
    });
    expect(result.current.marks.has('n2')).toBe(false);
  });

  it('undoes the last keep within its window by ⌘Z, and not after it', async () => {
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    });
    expect(result.current.marks.get('n1')?.phase).toBe('kept');
    let undone = false;
    act(() => {
      undone = result.current.undoLast();
    });
    expect(undone).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(assistantApi.decide).toHaveBeenLastCalledWith(BOARD, 's1', {
      decision: 'undo',
      source: 'shortcut',
    });
    expect(result.current.marks.has('n1')).toBe(false);
    act(() => {
      undone = result.current.undoLast();
    });
    expect(undone).toBe(false);
  });

  it('shows nothing when the server has nothing, refuses, or fails', async () => {
    vi.mocked(assistantApi.suggest).mockResolvedValueOnce({ suggestion: null });
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.marks.has('n1')).toBe(false);
    vi.mocked(assistantApi.suggest).mockRejectedValueOnce(new Error('502'));
    act(() => result.current.request('n2', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.marks.has('n2')).toBe(false);
  });

  it('drops the dot quietly when the keep finds the note changed', async () => {
    vi.mocked(assistantApi.decide).mockRejectedValueOnce(
      Object.assign(new Error('409'), { status: 409, code: 'STALE_REVISION' }),
    );
    const { result, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => result.current.request('n1', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    });
    expect(result.current.marks.has('n1')).toBe(false);
    expect(invalidate).toHaveBeenCalled();
  });

  it('shows the pending records of the board again after a reload, waiting for Enter', async () => {
    vi.mocked(assistantApi.pendingSuggestions).mockResolvedValue({
      suggestions: [dto({ id: 's9', noteId: 'n9' })],
    });
    const { result } = setup();
    // waitFor cannot poll under Vitest's fake timers (Testing Library only drives Jest's).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const mark = result.current.marks.get('n9');
    expect(mark?.phase).toBe('pending');
    // Nothing changes on a reload without being seen (the ruling amending plan R5).
    expect(mark?.countdownEndsAt).toBeNull();
    expect(mark?.paused).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 3);
    });
    expect(assistantApi.decide).not.toHaveBeenCalled();
    act(() => result.current.keep('n9', 'enter'));
    await flush();
    expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's9', {
      decision: 'keep',
      fields: ['dueDate', 'priority'],
      source: 'enter',
    });
  });

  it('runs no countdown for a proposal that names someone else; Enter is the named yes', async () => {
    vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
      suggestion: dto({
        fields: {
          dueDate: null,
          priority: null,
          assignee: { value: person('u-anna'), reason: 'for Anna' },
          title: null,
          reference: null,
          subtasks: null,
          links: null,
        },
      }),
    });
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    expect(result.current.marks.get('n1')?.phase).toBe('pending');
    expect(result.current.marks.get('n1')?.countdownEndsAt).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
    });
    expect(assistantApi.decide).not.toHaveBeenCalled();
  });

  it('counts down a proposal that assigns the note to the person themselves', async () => {
    vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
      suggestion: dto({
        fields: {
          dueDate: null,
          priority: null,
          assignee: { value: person(ME), reason: 'me' },
          title: null,
          reference: null,
          subtasks: null,
          links: null,
        },
      }),
    });
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    expect(result.current.marks.get('n1')?.countdownEndsAt).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    });
    expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
      decision: 'keep',
      fields: ['assignee'],
      source: 'countdown',
    });
  });

  it('discards on the server what a call dismissed with Esc proposes when it lands', async () => {
    let answer: () => void = () => {};
    vi.mocked(assistantApi.suggest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ suggestion: dto() });
        }),
    );
    const { result } = setup();
    act(() => result.current.request('n1', []));
    expect(result.current.marks.get('n1')?.phase).toBe('asking');
    act(() => result.current.discard('n1', 'esc'));
    expect(result.current.marks.has('n1')).toBe(false);
    await act(async () => {
      answer();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.marks.has('n1')).toBe(false);
    expect(assistantApi.decide).toHaveBeenCalledTimes(1);
    expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
      decision: 'discard',
      source: 'esc',
    });
    // The note asked about again is a call of its own, and shows its proposal.
    act(() => result.current.request('n1', []));
    await flush();
    expect(result.current.marks.get('n1')?.phase).toBe('pending');
  });

  it('sends a keep that got no answer once more, then keeps', async () => {
    vi.mocked(assistantApi.decide).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    act(() => result.current.keep('n1', 'enter'));
    await flush();
    expect(assistantApi.decide).toHaveBeenCalledTimes(1);
    // The dot is still there while the second try waits.
    expect(result.current.marks.get('n1')?.phase).toBe('pending');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KEEP_RETRY_MS);
    });
    expect(assistantApi.decide).toHaveBeenCalledTimes(2);
    expect(vi.mocked(assistantApi.decide).mock.calls[1]![2]).toEqual({
      decision: 'keep',
      fields: ['dueDate', 'priority'],
      source: 'enter',
    });
    expect(result.current.marks.get('n1')?.phase).toBe('kept');
  });

  it('tries a failing keep twice at most, and never retries a refusal', async () => {
    vi.mocked(assistantApi.decide)
      .mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }));
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    act(() => result.current.keep('n1', 'enter'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KEEP_RETRY_MS * 4);
    });
    expect(assistantApi.decide).toHaveBeenCalledTimes(2);
    expect(result.current.marks.has('n1')).toBe(false);

    vi.mocked(assistantApi.decide).mockRejectedValueOnce(
      Object.assign(new Error('409'), { status: 409, code: 'STALE_REVISION' }),
    );
    act(() => result.current.request('n2', []));
    await flush();
    act(() => result.current.keep('n2', 'enter'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KEEP_RETRY_MS * 4);
    });
    expect(assistantApi.decide).toHaveBeenCalledTimes(3);
  });

  it('stops every running countdown when the person switches to always ask me', async () => {
    const { result, rerender } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
      suggestion: dto({ id: 's2', noteId: 'n2' }),
    });
    act(() => result.current.request('n2', []));
    await flush();
    act(() => result.current.setPaused('n2', true));
    expect(result.current.marks.get('n1')?.countdownEndsAt).not.toBeNull();
    wallybot.autoApply = false;
    rerender();
    for (const id of ['n1', 'n2']) {
      expect(result.current.marks.get(id)?.countdownEndsAt, id).toBeNull();
      expect(result.current.marks.get(id)?.paused, id).toBe(false);
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
    });
    expect(assistantApi.decide).not.toHaveBeenCalled();
    // Switched back, the waiting marks keep waiting.
    wallybot.autoApply = true;
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
    });
    expect(result.current.marks.get('n1')?.countdownEndsAt).toBeNull();
    expect(assistantApi.decide).not.toHaveBeenCalled();
  });

  it('drops a pending change once the note moved past the revision it was proposed for', async () => {
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    act(() => result.current.syncNotes([{ id: 'n1', revision: 3 }]));
    expect(result.current.marks.get('n1')?.phase).toBe('pending');
    act(() => result.current.syncNotes([{ id: 'n1', revision: 4 }]));
    expect(result.current.marks.has('n1')).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
    });
    expect(assistantApi.decide).not.toHaveBeenCalled();
    // A proposal that lands for a note already past its base is not shown at all.
    vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
      suggestion: dto({ id: 's2', noteId: 'n2', baseRevision: 1 }),
    });
    act(() => result.current.syncNotes([{ id: 'n2', revision: 2 }]));
    act(() => result.current.request('n2', []));
    await flush();
    expect(result.current.marks.has('n2')).toBe(false);
  });

  it('leaves a kept change, and a keep on its way, to their own answers', async () => {
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    const answer = holdDecide();
    act(() => result.current.keep('n1', 'enter'));
    act(() => result.current.syncNotes([{ id: 'n1', revision: 4 }]));
    expect(result.current.marks.get('n1')?.phase).toBe('pending');
    await answer();
    act(() => result.current.syncNotes([{ id: 'n1', revision: 5 }]));
    expect(result.current.marks.get('n1')?.phase).toBe('kept');
  });

  it('does nothing while the assistant is off for the board', async () => {
    const { result } = setup(false);
    act(() => result.current.request('n1', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(assistantApi.suggest).not.toHaveBeenCalled();
    expect(assistantApi.pendingSuggestions).not.toHaveBeenCalled();
  });

  describe('one decision at a time', () => {
    it('refuses Esc, a remove, a pause and a second Enter while a keep is on its way', async () => {
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      const answer = holdDecide();
      act(() => result.current.keep('n1', 'enter'));
      expect(result.current.marks.get('n1')?.countdownEndsAt).toBeNull();
      act(() => result.current.discard('n1', 'esc'));
      act(() => result.current.remove('n1', 'priority'));
      act(() => result.current.setPaused('n1', true));
      act(() => result.current.keep('n1', 'enter'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
      });
      expect(assistantApi.decide).toHaveBeenCalledTimes(1);
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate', 'priority'],
        source: 'enter',
      });
      await answer();
      // The keep landed, and its Undo and ⌘Z are there for the Esc that came too early.
      const mark = result.current.marks.get('n1');
      expect(mark?.phase).toBe('kept');
      expect(mark?.fields).toEqual(['dueDate', 'priority']);
      let undone = false;
      act(() => {
        undone = result.current.undoLast();
      });
      expect(undone).toBe(true);
      await flush();
      expect(assistantApi.decide).toHaveBeenLastCalledWith(BOARD, 's1', {
        decision: 'undo',
        source: 'shortcut',
      });
      expect(result.current.marks.has('n1')).toBe(false);
    });

    it('does not restart the ring when the pointer leaves during a click keep', async () => {
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      act(() => result.current.setPaused('n1', true));
      const answer = holdDecide();
      act(() => result.current.keep('n1', 'click'));
      act(() => result.current.setPaused('n1', false));
      expect(result.current.marks.get('n1')?.countdownEndsAt).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
      });
      expect(assistantApi.decide).toHaveBeenCalledTimes(1);
      await answer();
      expect(result.current.marks.get('n1')?.phase).toBe('kept');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
      });
      // No second, countdown keep after the first one answered.
      expect(assistantApi.decide).toHaveBeenCalledTimes(1);
    });

    it('sends one undo however often it is asked while the first is on its way', async () => {
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
      });
      expect(result.current.marks.get('n1')?.phase).toBe('kept');
      const answer = holdDecide();
      let first = false;
      let second = true;
      act(() => {
        first = result.current.undoLast();
      });
      act(() => {
        second = result.current.undoLast();
      });
      act(() => result.current.undo('n1', 'click'));
      expect(first).toBe(true);
      expect(second).toBe(false);
      // The undo window cannot close under an undo on its way.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
      });
      expect(result.current.marks.get('n1')?.phase).toBe('kept');
      await answer();
      expect(vi.mocked(assistantApi.decide).mock.calls.map(([, , body]) => body.decision)).toEqual([
        'keep',
        'undo',
      ]);
      expect(result.current.marks.has('n1')).toBe(false);
    });
  });

  describe('the title, the reference and the steps', () => {
    const fields = (over: Partial<SuggestionDto['fields']>): SuggestionDto['fields'] => ({
      dueDate: null,
      priority: null,
      assignee: null,
      title: null,
      reference: null,
      subtasks: null,
      links: null,
      ...over,
    });
    const DATE = { value: '2026-10-23', reason: 'Friday' };
    const TITLE = { value: 'Quote for Müller', reason: 'shorter' };

    it('a proposed title waits for the person: the countdown keeps the date and leaves the title', async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({ fields: fields({ dueDate: DATE, title: TITLE }) }),
      });
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      expect(result.current.marks.get('n1')?.fields).toEqual(['dueDate']);
      expect(result.current.marks.get('n1')?.countdownEndsAt).not.toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
      });
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate'],
        source: 'countdown',
      });

      // Ticked before the countdown ends: only the person can keep it, so the change waits.
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({
          id: 's2',
          noteId: 'n2',
          fields: fields({ dueDate: DATE, title: TITLE }),
        }),
      });
      act(() => result.current.request('n2', []));
      await flush();
      act(() => result.current.setField('n2', 'title', true));
      expect(result.current.marks.get('n2')?.fields).toEqual(['dueDate', 'title']);
      expect(result.current.marks.get('n2')?.countdownEndsAt).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
      });
      expect(assistantApi.decide).toHaveBeenCalledTimes(1);
      act(() => result.current.keep('n2', 'enter'));
      await flush();
      expect(assistantApi.decide).toHaveBeenLastCalledWith(BOARD, 's2', {
        decision: 'keep',
        fields: ['dueDate', 'title'],
        source: 'enter',
      });
    });

    it('the proposed links in the change are the stored indexes, even when an earlier target dropped out', async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({
          fields: fields({
            dueDate: DATE,
            links: {
              items: [
                { index: 1, noteId: 'b', title: 'B', reason: 'same customer' },
                { index: 2, noteId: 'c', title: 'C', reason: 'same topic' },
              ],
              reason: 'related',
            },
          }),
        }),
      });
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      expect(result.current.marks.get('n1')?.links).toEqual([1, 2]);
    });

    it('a title alone runs no countdown and keeps only when ticked', async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({ fields: fields({ title: TITLE }) }),
      });
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      const mark = result.current.marks.get('n1');
      expect(mark?.phase).toBe('pending');
      expect(mark?.fields).toEqual([]);
      expect(mark?.countdownEndsAt).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
      });
      act(() => result.current.keep('n1', 'enter'));
      await flush();
      expect(assistantApi.decide).not.toHaveBeenCalled();
      expect(result.current.marks.get('n1')?.phase).toBe('pending');
      act(() => result.current.setField('n1', 'title', true));
      act(() => result.current.keep('n1', 'enter'));
      await flush();
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['title'],
        source: 'enter',
      });
    });

    it('stops the countdown once nothing but the title is left', async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({ fields: fields({ dueDate: DATE, title: TITLE }) }),
      });
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      act(() => result.current.setPaused('n1', true));
      act(() => result.current.setField('n1', 'title', true));
      act(() => result.current.setField('n1', 'dueDate', false));
      expect(result.current.marks.get('n1')?.fields).toEqual(['title']);
      // A pointer leaving the card does not bring a countdown back.
      act(() => result.current.setPaused('n1', false));
      expect(result.current.marks.get('n1')?.countdownEndsAt).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
      });
      expect(assistantApi.decide).not.toHaveBeenCalled();
      // A field the proposal does not hold cannot be ticked.
      act(() => result.current.setField('n1', 'priority', true));
      expect(result.current.marks.get('n1')?.fields).toEqual(['title']);
      act(() => result.current.setField('n1', 'title', false));
      await flush();
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'discard',
        source: 'remove',
      });
      expect(result.current.marks.has('n1')).toBe(false);
    });

    it('steps are kept one by one', async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({
          fields: fields({
            dueDate: DATE,
            subtasks: { items: ['a', 'b', 'c'], reason: 'steps' },
          }),
        }),
      });
      wallybot.autoApply = false;
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      const mark = () => result.current.marks.get('n1')!;
      expect(mark().fields).toEqual(['dueDate', 'subtasks']);
      expect(mark().subtasks).toEqual([0, 1, 2]);
      act(() => result.current.setSubtask('n1', 1, false));
      expect(mark().subtasks).toEqual([0, 2]);
      // An index the proposal does not hold changes nothing.
      act(() => result.current.setSubtask('n1', 3, true));
      expect(mark().subtasks).toEqual([0, 2]);
      act(() => result.current.setSubtask('n1', 0, false));
      act(() => result.current.setSubtask('n1', 2, false));
      expect(mark().fields).toEqual(['dueDate']);
      expect(mark().subtasks).toEqual([]);
      act(() => result.current.setSubtask('n1', 1, true));
      expect(mark().fields).toEqual(['dueDate', 'subtasks']);
      expect(mark().subtasks).toEqual([1]);
      act(() => result.current.setSubtask('n1', 0, true));
      expect(mark().subtasks).toEqual([0, 1]);
      act(() => result.current.keep('n1', 'enter'));
      await flush();
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate', 'subtasks'],
        subtasks: [0, 1],
        source: 'enter',
      });
    });

    it('links are kept one by one', async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({
          fields: fields({
            dueDate: DATE,
            links: {
              items: [
                { index: 0, noteId: 'b', title: 'B', reason: 'same customer' },
                { index: 1, noteId: 'c', title: 'C', reason: 'same topic' },
              ],
              reason: 'related',
            },
          }),
        }),
      });
      wallybot.autoApply = false;
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      const mark = () => result.current.marks.get('n1')!;
      expect(mark().fields).toEqual(['dueDate', 'links']);
      expect(mark().links).toEqual([0, 1]);
      act(() => result.current.setLink('n1', 0, false));
      expect(mark().links).toEqual([1]);
      // An index the proposal does not hold changes nothing.
      act(() => result.current.setLink('n1', 2, true));
      expect(mark().links).toEqual([1]);
      act(() => result.current.setLink('n1', 1, false));
      expect(mark().fields).toEqual(['dueDate']);
      expect(mark().links).toEqual([]);
      act(() => result.current.setLink('n1', 0, true));
      expect(mark().fields).toEqual(['dueDate', 'links']);
      expect(mark().links).toEqual([0]);
      act(() => result.current.keep('n1', 'enter'));
      await flush();
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate', 'links'],
        links: [0],
        source: 'enter',
      });
    });

    it('a link is named by its stored index, and the links tick back all at once', async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({
          fields: fields({
            dueDate: DATE,
            links: {
              items: [
                { index: 1, noteId: 'b', title: 'B', reason: 'same customer' },
                { index: 2, noteId: 'c', title: 'C', reason: 'same topic' },
              ],
              reason: 'related',
            },
          }),
        }),
      });
      wallybot.autoApply = false;
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      const mark = () => result.current.marks.get('n1')!;
      // Index 0 dropped out on the server (its target is gone): it cannot be ticked.
      act(() => result.current.setLink('n1', 0, true));
      expect(mark().links).toEqual([1, 2]);
      act(() => result.current.setLink('n1', 2, false));
      expect(mark().links).toEqual([1]);
      act(() => result.current.setLink('n1', 1, false));
      expect(mark().fields).toEqual(['dueDate']);
      act(() => result.current.setField('n1', 'links', true));
      expect(mark().fields).toEqual(['dueDate', 'links']);
      expect(mark().links).toEqual([1, 2]);
      act(() => result.current.setLink('n1', 1, false));
      act(() => result.current.keep('n1', 'click'));
      await flush();
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate', 'links'],
        links: [2],
        source: 'click',
      });
    });

    it("the countdown's keep carries the ticked links", async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({
          fields: fields({
            links: {
              items: [
                { index: 0, noteId: 'b', title: 'B', reason: 'same customer' },
                { index: 1, noteId: 'c', title: 'C', reason: 'same topic' },
              ],
              reason: 'related',
            },
          }),
        }),
      });
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      act(() => result.current.setLink('n1', 0, false));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
      });
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['links'],
        links: [1],
        source: 'countdown',
      });
    });

    it('ticks the steps all at once again, and leaves them out of a keep that drops them', async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({
          fields: fields({
            dueDate: DATE,
            subtasks: { items: ['a', 'b', 'c'], reason: 'steps' },
          }),
        }),
      });
      wallybot.autoApply = false;
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      act(() => result.current.setField('n1', 'subtasks', false));
      expect(result.current.marks.get('n1')?.fields).toEqual(['dueDate']);
      act(() => result.current.setField('n1', 'subtasks', true));
      expect(result.current.marks.get('n1')?.subtasks).toEqual([0, 1, 2]);
      act(() => result.current.remove('n1', 'subtasks'));
      act(() => result.current.keep('n1', 'enter'));
      await flush();
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate'],
        source: 'enter',
      });
    });

    it('unticking a ticked title does not start the countdown again: the change waits for Enter', async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({ fields: fields({ dueDate: DATE, title: TITLE }) }),
      });
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      expect(result.current.marks.get('n1')?.countdownEndsAt).not.toBeNull();
      act(() => result.current.setField('n1', 'title', true));
      act(() => result.current.setField('n1', 'title', false));
      expect(result.current.marks.get('n1')).toMatchObject({
        fields: ['dueDate'],
        countdownEndsAt: null,
        paused: false,
      });
      // Nor does a pointer leaving the card afterwards.
      act(() => result.current.setPaused('n1', false));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
      });
      expect(assistantApi.decide).not.toHaveBeenCalled();
      act(() => result.current.keep('n1', 'enter'));
      await flush();
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate'],
        source: 'enter',
      });
    });

    it('the last field out discards the whole change, though an unticked title is still offered', async () => {
      for (const take of ['untick', 'remove'] as const) {
        vi.mocked(assistantApi.decide).mockClear();
        vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
          suggestion: dto({ fields: fields({ dueDate: DATE, title: TITLE }) }),
        });
        const { result, unmount } = setup();
        act(() => result.current.request('n1', []));
        await flush();
        act(() =>
          take === 'untick'
            ? result.current.setField('n1', 'dueDate', false)
            : result.current.remove('n1', 'dueDate'),
        );
        await flush();
        expect(assistantApi.decide, take).toHaveBeenCalledWith(BOARD, 's1', {
          decision: 'discard',
          source: 'remove',
        });
        expect(result.current.marks.has('n1'), take).toBe(false);
        unmount();
      }
    });

    it('a ticked title leaves the dot waiting for Enter, with no ring', async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({ fields: fields({ dueDate: DATE, title: TITLE }) }),
      });
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      act(() => result.current.setField('n1', 'title', true));
      const mark = result.current.marks.get('n1')!;
      expect(mark.countdownEndsAt).toBeNull();
      expect(mark.paused).toBe(false);
      const { container } = render(<PendingDot mark={mark} onUndo={vi.fn()} />);
      expect(
        screen.getByRole('img', { name: 'Proposed changes, waiting for Enter' }),
      ).toBeInTheDocument();
      expect(container.querySelector('circle.fill-accent')).not.toBeNull();
      expect(container.querySelector('circle.animate-countdown')).toBeNull();
    });

    it('"use mine" drops the offered title, ticked or not; a title alone goes with it', async () => {
      // Ticked, beside a date: the title line goes, the date stays and waits for Enter.
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({ fields: fields({ dueDate: DATE, title: TITLE }) }),
      });
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      act(() => result.current.setField('n1', 'title', true));
      expect(proposedTitle(result.current.marks.get('n1')!)).toEqual(TITLE);
      act(() => result.current.remove('n1', 'title'));
      let mark = result.current.marks.get('n1')!;
      expect(mark.phase).toBe('pending');
      expect(mark.fields).toEqual(['dueDate']);
      expect(mark.titleDismissed).toBe(true);
      expect(proposedTitle(mark)).toBeNull();
      // Turned down, it is no longer on offer.
      act(() => result.current.setField('n1', 'title', true));
      expect(result.current.marks.get('n1')?.fields).toEqual(['dueDate']);
      act(() => result.current.keep('n1', 'enter'));
      await flush();
      expect(assistantApi.decide).toHaveBeenLastCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate'],
        source: 'enter',
      });

      // Unticked, beside a date: the line goes and the countdown runs on for the date.
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({
          id: 's2',
          noteId: 'n2',
          fields: fields({ dueDate: DATE, title: TITLE }),
        }),
      });
      act(() => result.current.request('n2', []));
      await flush();
      act(() => result.current.remove('n2', 'title'));
      mark = result.current.marks.get('n2')!;
      expect(mark.fields).toEqual(['dueDate']);
      expect(proposedTitle(mark)).toBeNull();
      expect(mark.countdownEndsAt).not.toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
      });
      expect(assistantApi.decide).toHaveBeenLastCalledWith(BOARD, 's2', {
        decision: 'keep',
        fields: ['dueDate'],
        source: 'countdown',
      });

      // A title alone: "use mine" leaves nothing, so the change is discarded.
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({ id: 's3', noteId: 'n3', fields: fields({ title: TITLE }) }),
      });
      act(() => result.current.request('n3', []));
      await flush();
      act(() => result.current.remove('n3', 'title'));
      await flush();
      expect(assistantApi.decide).toHaveBeenLastCalledWith(BOARD, 's3', {
        decision: 'discard',
        source: 'remove',
      });
      expect(result.current.marks.has('n3')).toBe(false);
    });

    it("a step ticked after the steps' × is that step alone, as after unticking them all", async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({
          fields: fields({
            dueDate: DATE,
            subtasks: { items: ['a', 'b', 'c'], reason: 'steps' },
          }),
        }),
      });
      wallybot.autoApply = false;
      const { result } = setup();
      act(() => result.current.request('n1', []));
      await flush();
      const mark = () => result.current.marks.get('n1')!;
      act(() => result.current.remove('n1', 'subtasks'));
      expect(mark().fields).toEqual(['dueDate']);
      // Unticking a step of a group that is out changes nothing.
      act(() => result.current.setSubtask('n1', 0, false));
      expect(mark().fields).toEqual(['dueDate']);
      act(() => result.current.setSubtask('n1', 1, true));
      expect(mark().fields).toEqual(['dueDate', 'subtasks']);
      expect(mark().subtasks).toEqual([1]);
      act(() => result.current.keep('n1', 'enter'));
      await flush();
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate', 'subtasks'],
        subtasks: [1],
        source: 'enter',
      });
    });

    it('a restored record keeps its typed list and its kept subtasks after a keep', async () => {
      const restored = dto({
        id: 's9',
        noteId: 'n9',
        typed: ['assignee'],
        fields: fields({ dueDate: DATE, subtasks: { items: ['a', 'b', 'c'], reason: 'steps' } }),
      });
      vi.mocked(assistantApi.pendingSuggestions).mockResolvedValue({ suggestions: [restored] });
      vi.mocked(assistantApi.decide).mockImplementationOnce(async (_b, _id, body) => ({
        suggestion: {
          ...restored,
          status: 'KEPT',
          kept: {
            fields: body.fields ?? [],
            subtasks: body.subtasks ?? [],
            links: [],
            revision: 5,
          },
        },
      }));
      const { result } = setup();
      await flush();
      expect(result.current.marks.get('n9')?.subtasks).toEqual([0, 1, 2]);
      act(() => result.current.setSubtask('n9', 1, false));
      act(() => result.current.keep('n9', 'enter'));
      await flush();
      const mark = result.current.marks.get('n9');
      expect(mark?.phase).toBe('kept');
      expect(mark?.suggestion?.typed).toEqual(['assignee']);
      expect(mark?.fields).toEqual(['dueDate', 'subtasks']);
      expect(mark?.subtasks).toEqual([0, 2]);
    });
  });

  describe('the pending list across visits', () => {
    it('reads the list from the server on every visit, never from an older cache', async () => {
      const queryClient = createTestQueryClient();
      // A list cached on an earlier visit: s9 has been decided since, s4 was added since.
      queryClient.setQueryData(PENDING_KEY, { suggestions: [dto({ id: 's9', noteId: 'n9' })] });
      let answer: () => void = () => {};
      vi.mocked(assistantApi.pendingSuggestions).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = () => resolve({ suggestions: [dto({ id: 's4', noteId: 'n4' })] });
          }),
      );
      const { result } = setup(true, queryClient);
      await flush();
      expect(result.current.marks.has('n9')).toBe(false);
      await act(async () => {
        answer();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(assistantApi.pendingSuggestions).toHaveBeenCalledTimes(1);
      expect(result.current.marks.has('n9')).toBe(false);
      expect(result.current.marks.get('n4')?.phase).toBe('pending');
      expect(result.current.marks.get('n4')?.countdownEndsAt).toBeNull();
    });

    it('keeps the cached list in step with the visit, and shows the server list on return', async () => {
      vi.mocked(assistantApi.pendingSuggestions).mockResolvedValueOnce({
        suggestions: [dto({ id: 's9', noteId: 'n9' })],
      });
      wallybot.autoApply = false;
      const first = setup();
      await flush();
      expect(first.result.current.marks.get('n9')?.phase).toBe('pending');
      act(() => first.result.current.keep('n9', 'enter'));
      await flush();
      expect(first.result.current.marks.get('n9')?.phase).toBe('kept');
      // Asked on this visit and left waiting (always ask me).
      act(() => first.result.current.request('n1', []));
      await flush();
      expect(first.result.current.marks.get('n1')?.phase).toBe('pending');
      expect(
        first.queryClient
          .getQueryData<{ suggestions: SuggestionDto[] }>(PENDING_KEY)
          ?.suggestions.map((s) => s.id),
      ).toEqual(['s1']);
      first.unmount();

      // Back on the board within the cache's lifetime: the server's list decides.
      vi.mocked(assistantApi.pendingSuggestions).mockResolvedValueOnce({
        suggestions: [dto({ id: 's1', noteId: 'n1' })],
      });
      const second = setup(true, first.queryClient);
      await flush();
      expect(assistantApi.pendingSuggestions).toHaveBeenCalledTimes(2);
      expect(second.result.current.marks.has('n9')).toBe(false);
      expect(second.result.current.marks.get('n1')?.phase).toBe('pending');
      expect(assistantApi.decide).toHaveBeenCalledTimes(1);
    });
  });
});
