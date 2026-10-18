import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { NoteDto, TidyDto } from '@wally/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  assistantApi: { tidy: vi.fn(), decideTidy: vi.fn() },
}));

import { assistantApi } from '@/lib/resources';
import { makeNote } from '@/test/fixtures';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { scopedQueryKeys } from '../hooks/queryKeys';
import { UNDO_WINDOW_MS } from '../Suggestions/useSuggestions';
import { EMPTY_NOTICE_MS, useTidy } from './useTidy';

const BOARD = 'board-1';
const keys = scopedQueryKeys(null);
const all = () => true;
const none: ReadonlySet<string> = new Set();

const late = makeNote({ id: 'late', horizon: 'DIESE_WOCHE', dueDate: '2026-10-19', revision: 2 });
const jotted = makeNote({ id: 'jotted', horizon: 'HEUTE', dueDate: null, revision: 1 });
const placed = makeNote({ id: 'placed', horizon: 'SPAETER', dueDate: null });

const dto = (over: Partial<TidyDto> = {}): TidyDto => ({
  id: 't1',
  boardId: BOARD,
  status: 'PENDING',
  moves: [
    {
      noteId: 'late',
      baseRevision: 2,
      from: 'DIESE_WOCHE',
      to: 'SPAETER',
      reason: null,
      source: 'date',
    },
    {
      noteId: 'jotted',
      baseRevision: 1,
      from: 'HEUTE',
      to: 'SPAETER',
      reason: 'next month',
      source: 'words',
    },
  ],
  kept: null,
  createdAt: '2026-10-17T10:00:00.000Z',
  ...over,
});
const kept = (noteIds = ['late', 'jotted'], skipped: string[] = []) =>
  dto({ status: 'KEPT', kept: { noteIds, skipped } });

function setup(notes: NoteDto[] = [late, jotted, placed], enabled = true) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(keys.notes(BOARD), notes);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ list }: { list: NoteDto[] }) => useTidy(BOARD, enabled, list, all, none),
    { wrapper, initialProps: { list: notes } },
  );
  const cached = () => queryClient.getQueryData<NoteDto[]>(keys.notes(BOARD))!;
  return { queryClient, cached, ...hook };
}
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

describe('useTidy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(assistantApi.tidy).mockReset();
    vi.mocked(assistantApi.decideTidy).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('counts the candidates without a request, and nothing when off', () => {
    const { result } = setup();
    expect(result.current).toMatchObject({ phase: 'idle', count: 2 });
    expect(assistantApi.tidy).not.toHaveBeenCalled();
    const off = setup([late, jotted, placed], false);
    expect(off.result.current.count).toBe(0);
  });

  it('asks with the browser date and zone and shows each move on its note', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    const { result } = setup();
    act(() => result.current.tidy());
    expect(result.current.phase).toBe('asking');
    await settle();
    const [boardId, body] = vi.mocked(assistantApi.tidy).mock.calls[0]!;
    expect(boardId).toBe(BOARD);
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.current).toMatchObject({ phase: 'pending', moving: 2 });
    expect(result.current.markFor('late')).toEqual({
      to: 'SPAETER',
      from: 'DIESE_WOCHE',
      reason: null,
      source: 'date',
      phase: 'pending',
    });
    expect(result.current.markFor('jotted')?.reason).toBe('next month');
    expect(result.current.markFor('placed')).toBeUndefined();
    expect(result.current.trackedIds).toEqual(['late', 'jotted']);
  });

  it('nothing to move shows the notice for a while and hides the affordance until a candidate changes', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: null });
    const { result, rerender } = setup();
    act(() => result.current.tidy());
    await settle();
    expect(result.current).toMatchObject({ phase: 'empty', count: 0 });
    await act(() => vi.advanceTimersByTimeAsync(EMPTY_NOTICE_MS));
    expect(result.current).toMatchObject({ phase: 'idle', count: 0 });
    // A new note in Today is a new candidate: the affordance is back.
    rerender({
      list: [late, jotted, placed, makeNote({ id: 'new', horizon: 'HEUTE', dueDate: null })],
    });
    expect(result.current.count).toBe(3);
  });

  it('a keep patches the cache first, sends the chosen notes, then opens the undo window', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    let answer!: (value: { tidy: TidyDto }) => void;
    vi.mocked(assistantApi.decideTidy).mockReturnValue(new Promise((r) => (answer = r)));
    const { result, cached } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('SPAETER');
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('SPAETER');
    expect(result.current).toMatchObject({ phase: 'kept', moving: 2 });
    expect(result.current.markFor('late')?.phase).toBe('kept');
    expect(assistantApi.decideTidy).toHaveBeenCalledWith(BOARD, 't1', {
      decision: 'keep',
      noteIds: ['late', 'jotted'],
      source: 'enter',
    });
    await act(async () => {
      answer({ tidy: kept() });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe('kept');
    await act(() => vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS));
    expect(result.current).toMatchObject({ phase: 'idle', count: 0 });
    expect(result.current.markFor('late')).toBeUndefined();
  });

  it('a note the server skipped goes back to where it was; a refusal puts every note back', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    vi.mocked(assistantApi.decideTidy).mockResolvedValueOnce({ tidy: kept(['late'], ['jotted']) });
    const { result, cached } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('click'));
    await settle();
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('SPAETER');
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('HEUTE');
    expect(result.current.markFor('jotted')).toBeUndefined();
    expect(result.current.markFor('late')?.phase).toBe('kept');

    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto({ id: 't2' }) });
    // The undo is answered; the refusal is the next keep's.
    vi.mocked(assistantApi.decideTidy)
      .mockResolvedValueOnce({
        tidy: dto({ status: 'UNDONE', kept: { noteIds: ['late'], skipped: ['jotted'] } }),
      })
      .mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409 }));
    act(() => result.current.undo('click'));
    await settle();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('SPAETER');
    await settle();
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('DIESE_WOCHE');
    expect(result.current.phase).toBe('idle');
  });

  it('the × takes a note out of the batch; the last one out discards it', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    vi.mocked(assistantApi.decideTidy).mockResolvedValue({ tidy: dto({ status: 'DISCARDED' }) });
    const { result } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.remove('late'));
    expect(result.current.moving).toBe(1);
    expect(result.current.markFor('late')).toBeUndefined();
    act(() => result.current.remove('jotted'));
    await settle();
    expect(assistantApi.decideTidy).toHaveBeenCalledWith(BOARD, 't1', {
      decision: 'discard',
      source: 'remove',
    });
    expect(result.current.phase).toBe('idle');
  });

  it('a note edited while the batch is pending leaves it', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    const { result, rerender } = setup();
    act(() => result.current.tidy());
    await settle();
    rerender({ list: [{ ...late, revision: 3 }, jotted, placed] });
    expect(result.current.markFor('late')).toBeUndefined();
    expect(result.current.moving).toBe(1);
  });

  it('an undo puts the notes back at once, tells the server, and ⌘Z finds the batch', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    vi.mocked(assistantApi.decideTidy)
      .mockResolvedValueOnce({ tidy: kept() })
      .mockResolvedValueOnce({
        tidy: dto({ status: 'UNDONE', kept: { noteIds: ['late', 'jotted'], skipped: [] } }),
      });
    const { result, cached } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    await settle();
    let took = false;
    act(() => {
      took = result.current.undoLast();
    });
    expect(took).toBe(true);
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('DIESE_WOCHE');
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('HEUTE');
    await settle();
    expect(assistantApi.decideTidy).toHaveBeenLastCalledWith(BOARD, 't1', {
      decision: 'undo',
      source: 'shortcut',
    });
    expect(result.current.phase).toBe('idle');
    expect(result.current.undoLast()).toBe(false);
  });
});
