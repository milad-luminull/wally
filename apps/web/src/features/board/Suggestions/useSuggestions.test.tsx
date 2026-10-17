import { act, renderHook } from '@testing-library/react';
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
import { COUNTDOWN_MS, UNDO_WINDOW_MS, useSuggestions } from './useSuggestions';

const BOARD = 'board-1';
const dto = (over: Partial<SuggestionDto> = {}): SuggestionDto => ({
  id: 's1',
  boardId: BOARD,
  noteId: 'n1',
  status: 'PENDING',
  baseRevision: 3,
  fields: {
    dueDate: { value: '2026-10-23', reason: 'Freitag' },
    priority: { value: 'HOCH', reason: 'dringend' },
    assignee: null,
  },
  kept: null,
  createdAt: '2026-10-17T10:00:00.000Z',
  ...over,
});

function setup(enabled = true) {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => useSuggestions(BOARD, enabled), { wrapper }) };
}

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
          ? { fields: body.fields ?? ['dueDate', 'priority'], revision: 5 }
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
    expect(assistantApi.decide).toHaveBeenLastCalledWith(BOARD, 's2', {
      decision: 'discard',
      source: 'esc',
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

  it('shows the pending records of the board again after a reload', async () => {
    vi.mocked(assistantApi.pendingSuggestions).mockResolvedValue({
      suggestions: [dto({ id: 's9', noteId: 'n9' })],
    });
    const { result } = setup();
    // waitFor cannot poll under Vitest's fake timers (Testing Library only drives Jest's).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.marks.get('n9')?.phase).toBe('pending');
    expect(result.current.marks.get('n9')?.countdownEndsAt).not.toBeNull();
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
});
