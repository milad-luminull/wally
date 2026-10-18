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
import { nextKeptStamp } from '../Suggestions/keptOrder';
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

/** The controller with `enabled` the caller can flip: the horizon wall left and come back to. */
function setupSwitch() {
  const queryClient = createTestQueryClient();
  const notes = [late, jotted, placed];
  queryClient.setQueryData(keys.notes(BOARD), notes);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ enabled }: { enabled: boolean }) => useTidy(BOARD, enabled, notes, all, none),
    { wrapper, initialProps: { enabled: true } },
  );
}

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
    const { result, cached, rerender } = setup();
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
    // The wall draws the cache: the list follows it, as AppShell's does.
    rerender({ list: cached() });
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

  it('a note edited while the batch is pending (its revision past the proposal’s) leaves it', async () => {
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

  it('a keep the server answers with nothing moved puts every card back, offers no undo and says nothing', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    // Both notes were edited in another tab after the proposal: the server skips them all.
    vi.mocked(assistantApi.decideTidy).mockResolvedValueOnce({
      tidy: kept([], ['late', 'jotted']),
    });
    const { result, cached } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    expect(result.current).toMatchObject({ phase: 'kept', moving: 2 });
    await settle();
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('DIESE_WOCHE');
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('HEUTE');
    expect(result.current).toMatchObject({ phase: 'idle', moving: 0, trackedIds: [] });
    expect(result.current.markFor('late')).toBeUndefined();
    expect(result.current.markFor('jotted')).toBeUndefined();
    let took = true;
    act(() => {
      took = result.current.undoLast();
    });
    expect(took).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS));
    expect(assistantApi.decideTidy).toHaveBeenCalledTimes(1);
  });

  it('off with a batch pending (another axis, the assistant off), the batch goes and nothing is marked', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    const { result, rerender } = setupSwitch();
    act(() => result.current.tidy());
    await settle();
    expect(result.current.trackedIds).toEqual(['late', 'jotted']);
    rerender({ enabled: false });
    expect(result.current).toMatchObject({ phase: 'idle', count: 0, moving: 0, trackedIds: [] });
    expect(result.current.markFor('late')).toBeUndefined();
    // Enter on a card that was marked keeps nothing.
    act(() => result.current.keep('enter'));
    // Back on the horizon wall: the batch does not come back; nothing was decided on the server.
    rerender({ enabled: true });
    expect(result.current.phase).toBe('idle');
    expect(result.current.markFor('late')).toBeUndefined();
    expect(assistantApi.decideTidy).not.toHaveBeenCalled();
  });

  it('off while the proposal is on its way, its answer changes nothing', async () => {
    let answer!: (value: { tidy: TidyDto }) => void;
    vi.mocked(assistantApi.tidy).mockReturnValue(new Promise((r) => (answer = r)));
    const { result, rerender } = setupSwitch();
    act(() => result.current.tidy());
    expect(result.current.phase).toBe('asking');
    rerender({ enabled: false });
    expect(result.current.phase).toBe('idle');
    await act(async () => {
      answer({ tidy: dto() });
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({ enabled: true });
    expect(result.current.phase).toBe('idle');
    expect(result.current.trackedIds).toEqual([]);
  });

  it('off with the batch kept, it is out of sight and ⌘Z leaves it; back within the window, it is there', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    vi.mocked(assistantApi.decideTidy).mockResolvedValueOnce({ tidy: kept() });
    const { result, rerender } = setupSwitch();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    await settle();
    expect(result.current.lastKeptAt()).not.toBeNull();
    rerender({ enabled: false });
    expect(result.current).toMatchObject({ phase: 'kept', moving: 0, trackedIds: [] });
    expect(result.current.markFor('late')).toBeUndefined();
    expect(result.current.lastKeptAt()).toBeNull();
    let took = true;
    act(() => {
      took = result.current.undoLast();
    });
    expect(took).toBe(false);
    rerender({ enabled: true });
    expect(result.current.markFor('late')?.phase).toBe('kept');
    expect(result.current.trackedIds).toEqual(['late', 'jotted']);
    expect(assistantApi.decideTidy).toHaveBeenCalledTimes(1);
  });

  it('names when the kept batch was kept, after a keep made before it, and nothing once undone', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    vi.mocked(assistantApi.decideTidy)
      .mockResolvedValueOnce({ tidy: kept() })
      .mockResolvedValueOnce({
        tidy: dto({ status: 'UNDONE', kept: { noteIds: ['late', 'jotted'], skipped: [] } }),
      });
    const { result } = setup();
    expect(result.current.lastKeptAt()).toBeNull();
    act(() => result.current.tidy());
    await settle();
    expect(result.current.lastKeptAt()).toBeNull();
    const earlier = nextKeptStamp();
    act(() => result.current.keep('click'));
    expect(result.current.lastKeptAt()).toBeGreaterThan(earlier);
    await settle();
    expect(result.current.lastKeptAt()).toBeGreaterThan(earlier);
    act(() => result.current.undo('click'));
    expect(result.current.lastKeptAt()).toBeNull();
    await settle();
  });

  it('a proposal naming a note the list does not hold (a filter hides it) offers only the shown moves', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    vi.mocked(assistantApi.decideTidy).mockResolvedValueOnce({ tidy: kept(['late']) });
    // `jotted` is filtered out of the wall: the server proposed it, the person cannot see it.
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(keys.notes(BOARD), [late, jotted, placed]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    // Every render's bar, so a count that flashes the hidden move is caught too.
    const seen: number[] = [];
    const shown = [late, placed];
    const { result } = renderHook(
      () => {
        const controller = useTidy(BOARD, true, shown, all, none);
        if (controller.phase === 'pending') seen.push(controller.moving);
        return controller;
      },
      { wrapper },
    );
    expect(result.current.count).toBe(1);
    act(() => result.current.tidy());
    await settle();
    expect(result.current).toMatchObject({ phase: 'pending', moving: 1, trackedIds: ['late'] });
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([1]));
    expect(result.current.markFor('jotted')).toBeUndefined();
    act(() => result.current.keep('enter'));
    expect(assistantApi.decideTidy).toHaveBeenCalledWith(BOARD, 't1', {
      decision: 'keep',
      noteIds: ['late'],
      source: 'enter',
    });
    await settle();
  });

  it('a proposal whose every move is hidden reads as nothing to tidy', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({
      tidy: dto({ moves: [dto().moves[1]!] }),
    });
    const { result } = setup([late, placed]);
    act(() => result.current.tidy());
    await settle();
    expect(result.current).toMatchObject({ phase: 'empty', moving: 0, trackedIds: [] });
  });

  it('a proposal asks the board’s notes to catch up', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    const { result, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => result.current.tidy());
    await settle();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.notes(BOARD) });
  });

  it('a note whose cached revision is behind the proposal’s stays in the batch (the cache lags)', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    const { result, rerender } = setup();
    act(() => result.current.tidy());
    await settle();
    rerender({ list: [{ ...late, revision: 1 }, jotted, placed] });
    expect(result.current.markFor('late')?.phase).toBe('pending');
    expect(result.current.moving).toBe(2);
  });

  it('a note that leaves the list while the batch is pending leaves the batch', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    const { result, rerender } = setup();
    act(() => result.current.tidy());
    await settle();
    rerender({ list: [jotted, placed] });
    expect(result.current.markFor('late')).toBeUndefined();
    expect(result.current).toMatchObject({ phase: 'pending', moving: 1 });
  });

  it('a batch every note of which was edited is discarded, with Esc’s source', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    vi.mocked(assistantApi.decideTidy).mockResolvedValue({ tidy: dto({ status: 'DISCARDED' }) });
    const { result, rerender } = setup();
    act(() => result.current.tidy());
    await settle();
    rerender({ list: [{ ...late, revision: 3 }, { ...jotted, revision: 2 }, placed] });
    await settle();
    expect(assistantApi.decideTidy).toHaveBeenCalledWith(BOARD, 't1', {
      decision: 'discard',
      source: 'esc',
    });
    expect(result.current.phase).toBe('idle');
  });

  it('a failed request goes back to idle with the affordance still there', async () => {
    vi.mocked(assistantApi.tidy).mockRejectedValue(new Error('offline'));
    const { result } = setup();
    expect(result.current.count).toBe(2);
    act(() => result.current.tidy());
    await settle();
    expect(result.current).toMatchObject({ phase: 'idle', count: 2 });
  });

  it('a keep answered with a status other than KEPT puts every card back and keeps the affordance', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    vi.mocked(assistantApi.decideTidy).mockResolvedValueOnce({
      tidy: dto({ status: 'DISCARDED' }),
    });
    const { result, cached, rerender } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    await settle();
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('DIESE_WOCHE');
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('HEUTE');
    rerender({ list: cached() });
    expect(result.current).toMatchObject({ phase: 'idle', count: 2 });
  });

  it('a keep refused by the server keeps the affordance', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    vi.mocked(assistantApi.decideTidy).mockRejectedValueOnce(new Error('offline'));
    const { result, cached, rerender } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('click'));
    await settle();
    rerender({ list: cached() });
    expect(result.current).toMatchObject({ phase: 'idle', count: 2 });
  });

  it('switched off while pending, the affordance is there again when it is back on', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    const { result, rerender } = setupSwitch();
    act(() => result.current.tidy());
    await settle();
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(result.current).toMatchObject({ phase: 'idle', count: 2 });
  });

  it('an undo pressed while the keep is on its way is sent after the keep’s answer, and ends undone', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    let keepAnswer!: (value: { tidy: TidyDto }) => void;
    let undoAnswer!: (value: { tidy: TidyDto }) => void;
    vi.mocked(assistantApi.decideTidy)
      .mockReturnValueOnce(new Promise((r) => (keepAnswer = r)))
      .mockReturnValueOnce(new Promise((r) => (undoAnswer = r)));
    const { result, cached } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    act(() => result.current.undo('click'));
    // The cards are back at once; the server has heard only the keep.
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('DIESE_WOCHE');
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('HEUTE');
    await settle();
    expect(assistantApi.decideTidy).toHaveBeenCalledTimes(1);
    await act(async () => {
      keepAnswer({ tidy: kept() });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(assistantApi.decideTidy).toHaveBeenCalledTimes(2);
    expect(assistantApi.decideTidy).toHaveBeenLastCalledWith(BOARD, 't1', {
      decision: 'undo',
      source: 'click',
    });
    // The keep's answer did not put the cards on their destinations.
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('DIESE_WOCHE');
    await act(async () => {
      undoAnswer({
        tidy: dto({ status: 'UNDONE', kept: { noteIds: ['late', 'jotted'], skipped: [] } }),
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('DIESE_WOCHE');
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('HEUTE');
    expect(result.current).toMatchObject({ phase: 'idle', moving: 0 });
    expect(result.current.undoLast()).toBe(false);
  });

  it('an undo pressed while a keep that then fails is on its way sends nothing more', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    let keepFail!: (error: Error) => void;
    vi.mocked(assistantApi.decideTidy).mockReturnValueOnce(
      new Promise((_, reject) => (keepFail = reject)),
    );
    const { result, cached } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    act(() => result.current.undo('click'));
    await act(async () => {
      keepFail(new Error('offline'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(assistantApi.decideTidy).toHaveBeenCalledTimes(1);
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('DIESE_WOCHE');
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('HEUTE');
    expect(result.current.phase).toBe('idle');
  });

  it('an undo the server refuses puts the cards back on their destinations', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    vi.mocked(assistantApi.decideTidy)
      .mockResolvedValueOnce({ tidy: kept() })
      .mockRejectedValueOnce(Object.assign(new Error('settled'), { status: 409 }));
    const { result, cached } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    await settle();
    act(() => result.current.undo('click'));
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('DIESE_WOCHE');
    await settle();
    expect(cached().find((n) => n.id === 'late')?.horizon).toBe('SPAETER');
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('SPAETER');
    expect(result.current.phase).toBe('idle');
  });

  it('a keep is remembered when its answer is applied: a note changed in the undo window brings the affordance back', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    vi.mocked(assistantApi.decideTidy).mockResolvedValueOnce({ tidy: kept() });
    const { result, cached, rerender } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    await settle();
    rerender({ list: cached() });
    // A note jotted in Today while Undo is still offered: a new candidate.
    rerender({ list: [...cached(), makeNote({ id: 'new', horizon: 'HEUTE', dueDate: null })] });
    await act(() => vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS));
    expect(result.current).toMatchObject({ phase: 'idle', count: 1 });
  });

  it('an undo is remembered once its answer is in and the notes caught up with it', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    const { result, cached, rerender, queryClient } = setup();
    vi.mocked(assistantApi.decideTidy)
      .mockResolvedValueOnce({ tidy: kept() })
      .mockImplementationOnce(async () => {
        // The moves back gave the notes new revisions, as the refetch shows them.
        queryClient.setQueryData<NoteDto[]>(keys.notes(BOARD), (list) =>
          list?.map((n) => (n.id === 'placed' ? n : { ...n, revision: n.revision + 2 })),
        );
        return {
          tidy: dto({ status: 'UNDONE', kept: { noteIds: ['late', 'jotted'], skipped: [] } }),
        };
      });
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    await settle();
    act(() => result.current.undo('click'));
    await settle();
    rerender({ list: cached() });
    expect(result.current).toMatchObject({ phase: 'idle', count: 0 });
  });

  it('a keep takes its own snapshots, so a failed keep restores the board as it was just before it', async () => {
    vi.mocked(assistantApi.tidy)
      .mockResolvedValueOnce({ tidy: dto() })
      .mockResolvedValueOnce({
        tidy: dto({ id: 't2', moves: [{ ...dto().moves[0]!, from: 'HEUTE', baseRevision: 3 }] }),
      });
    vi.mocked(assistantApi.decideTidy)
      .mockResolvedValueOnce({ tidy: kept() })
      .mockResolvedValueOnce({
        tidy: dto({ status: 'UNDONE', kept: { noteIds: ['late', 'jotted'], skipped: [] } }),
      })
      // The second keep fails.
      .mockRejectedValueOnce(new Error('offline'));
    const { result, cached, rerender, queryClient } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    await settle();
    act(() => result.current.undo('click'));
    await settle();
    // The board catches up with a collaborator who put `late` in Today meanwhile.
    queryClient.setQueryData<NoteDto[]>(keys.notes(BOARD), (list) =>
      list?.map((n) => (n.id === 'late' ? { ...n, horizon: 'HEUTE', revision: 3 } : n)),
    );
    rerender({ list: cached() });
    act(() => result.current.tidy());
    await settle();
    expect(result.current.phase).toBe('pending');
    act(() => result.current.keep('enter'));
    await settle();
    // Back where it was just before this keep, not where it was before the first one.
    expect(cached().find((n) => n.id === 'late')).toMatchObject({ horizon: 'HEUTE', revision: 3 });
  });

  it('a Tidy pressed while an undo waits for its keep is ignored; the next batch keeps its cards and its snapshots', async () => {
    const second = dto({
      id: 't2',
      moves: [{ ...dto().moves[1]!, to: 'DIESE_WOCHE', reason: 'by Friday' }],
    });
    vi.mocked(assistantApi.tidy)
      .mockResolvedValueOnce({ tidy: dto() })
      .mockResolvedValueOnce({ tidy: second });
    let keepOneFail!: (error: Error) => void;
    let keepTwoFail!: (error: Error) => void;
    vi.mocked(assistantApi.decideTidy)
      .mockReturnValueOnce(new Promise((_, reject) => (keepOneFail = reject)))
      .mockReturnValueOnce(new Promise((_, reject) => (keepTwoFail = reject)));
    const { result, cached } = setup();
    act(() => result.current.tidy());
    await settle();
    // Keep 1 on its way, then Undo: the cards are back and the bar is idle.
    act(() => result.current.keep('enter'));
    act(() => result.current.undo('click'));
    // A Tidy before keep 1 answers starts no batch 2 that keep 1's answer could overtake.
    act(() => result.current.tidy());
    await settle();
    expect(result.current).toMatchObject({ phase: 'idle', count: 0 });
    expect(assistantApi.tidy).toHaveBeenCalledTimes(1);
    // Keep 1 fails: nothing to undo; the cards are back and the affordance with them.
    await act(async () => {
      keepOneFail(new Error('offline'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('HEUTE');
    expect(result.current).toMatchObject({ phase: 'idle', count: 2 });
    // Batch 2: `jotted` was in batch 1 too.
    act(() => result.current.tidy());
    await settle();
    expect(result.current.phase).toBe('pending');
    act(() => result.current.keep('click'));
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('DIESE_WOCHE');
    await settle();
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('DIESE_WOCHE');
    // Keep 2's snapshot is there: its refusal puts the card back where it was before keep 2.
    await act(async () => {
      keepTwoFail(new Error('offline'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(cached().find((n) => n.id === 'jotted')?.horizon).toBe('HEUTE');
    expect(result.current.phase).toBe('idle');
  });

  it('while an undo is on its way the bar offers nothing and a Tidy is ignored; then the count follows the rule', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    let undoAnswer!: (value: { tidy: TidyDto }) => void;
    vi.mocked(assistantApi.decideTidy)
      .mockResolvedValueOnce({ tidy: kept() })
      .mockReturnValueOnce(new Promise((r) => (undoAnswer = r)));
    const { result, cached, rerender } = setup();
    act(() => result.current.tidy());
    await settle();
    act(() => result.current.keep('enter'));
    await settle();
    rerender({ list: cached() });
    act(() => result.current.undo('click'));
    // The cards are back, and so are the candidates; the undo has not been answered yet.
    rerender({ list: cached() });
    await settle();
    expect(result.current).toMatchObject({ phase: 'idle', count: 0 });
    act(() => result.current.tidy());
    expect(result.current.phase).toBe('idle');
    expect(assistantApi.tidy).toHaveBeenCalledTimes(1);
    await act(async () => {
      undoAnswer({
        tidy: dto({ status: 'UNDONE', kept: { noteIds: ['late', 'jotted'], skipped: [] } }),
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    // The undo is the run's outcome: remembered, so the same candidates are not offered again.
    rerender({ list: cached() });
    expect(result.current).toMatchObject({ phase: 'idle', count: 0 });
    // A note jotted in Today since is a new candidate: the affordance is back.
    rerender({ list: [...cached(), makeNote({ id: 'new', horizon: 'HEUTE', dueDate: null })] });
    expect(result.current.count).toBe(3);
    act(() => result.current.tidy());
    expect(result.current.phase).toBe('asking');
    await settle();
  });

  it('the count follows the date: at midnight a note due that day joins it', async () => {
    // Saturday a minute before midnight: a note due on Sunday belongs to This week.
    vi.setSystemTime(new Date(2026, 9, 17, 23, 59, 0));
    const sunday = makeNote({ id: 'sunday', horizon: 'DIESE_WOCHE', dueDate: '2026-10-18' });
    const { result } = setup([sunday]);
    expect(result.current.count).toBe(0);
    // Sunday: it is due today, so it belongs to Today.
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(result.current.count).toBe(1);
  });

  it('keeps its callbacks and its value when the caller passes a new canMove and busy set', async () => {
    vi.mocked(assistantApi.tidy).mockResolvedValue({ tidy: dto() });
    const queryClient = createTestQueryClient();
    const notes = [late, jotted, placed];
    queryClient.setQueryData(keys.notes(BOARD), notes);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    // A fresh function and a fresh set on every render: the worst a caller can do.
    const { result, rerender } = renderHook(
      () => useTidy(BOARD, true, notes, () => true, new Set<string>()),
      { wrapper },
    );
    const idle = result.current;
    rerender();
    expect(result.current).toBe(idle);
    act(() => result.current.tidy());
    await settle();
    const pending = result.current;
    expect(pending.phase).toBe('pending');
    rerender();
    rerender();
    expect(result.current).toBe(pending);
    expect(result.current.moving).toBe(2);
  });
});
