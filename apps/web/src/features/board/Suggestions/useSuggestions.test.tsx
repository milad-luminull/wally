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
import { captureMutation, enqueueMutation } from '@/lib/mutationQueue';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { scopedQueryKeys } from '../hooks/queryKeys';
import {
  COUNTDOWN_MS,
  KEEP_RETRY_MS,
  OUTCOME_FADE_MS,
  UNDO_WINDOW_MS,
  useSuggestions,
} from './useSuggestions';
import { nextKeptStamp } from './keptOrder';

const BOARD = 'board-1';
const dto = (over: Partial<SuggestionDto> = {}): SuggestionDto => ({
  id: 's1',
  boardId: BOARD,
  noteId: 'n1',
  status: 'PENDING',
  baseRevision: 3,
  fields: {
    dueDate: { value: '2026-10-23', reason: 'Friday' },
    priority: { value: 'HIGH', reason: 'urgent' },
    assignee: null,
    title: null,
    reference: null,
    subtasks: null,
    links: null,
    horizon: null,
    visibility: null,
    tags: null,
    properties: null,
    description: null,
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
                  ? {
                      fields: body.fields ?? [],
                      subtasks: [],
                      links: [],
                      tags: [],
                      properties: [],
                      revision: 5,
                    }
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
              tags: [],
              properties: [],
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

  it('removes a field before keeping; the last one out stops the countdown and waits', async () => {
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
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
    });
    // Crossed out row by row, the card stays to bring a row back: nothing is decided yet.
    const waiting = result.current.marks.get('n2');
    expect(waiting).toMatchObject({ phase: 'pending', fields: [], countdownEndsAt: null });
    expect(assistantApi.decide).not.toHaveBeenCalledWith(BOARD, 's2', expect.anything());
    // Keep with everything crossed out keeps nothing: the proposal is discarded.
    act(() => result.current.keep('n2', 'click'));
    await flush();
    expect(assistantApi.decide).toHaveBeenLastCalledWith(BOARD, 's2', {
      decision: 'discard',
      source: 'click',
    });
    expect(result.current.marks.has('n2')).toBe(false);
  });

  it('counts down fifteen seconds', () => {
    expect(COUNTDOWN_MS).toBe(15_000);
  });

  it('the title row × crosses the cleaned title out with its description, and ↺ brings both back', async () => {
    vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
      suggestion: dto({
        fields: {
          ...dto().fields,
          title: { value: 'Call doctor', reason: 'shorter' },
          description: { value: 'For the health check.', reason: 'moved' },
        },
      }),
    });
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    expect(result.current.marks.get('n1')?.fields).toEqual(
      expect.arrayContaining(['title', 'description']),
    );
    act(() => result.current.remove('n1', 'title'));
    expect(result.current.marks.get('n1')?.fields).toEqual(['dueDate', 'priority']);
    act(() => result.current.setField('n1', 'title', true));
    expect(result.current.marks.get('n1')?.fields).toEqual(
      expect.arrayContaining(['title', 'description']),
    );
  });

  it('a cleaned title alone counts down and is kept by the countdown', async () => {
    vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
      suggestion: dto({
        fields: {
          ...dto().fields,
          dueDate: null,
          priority: null,
          title: { value: 'Call doctor', reason: 'shorter' },
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
      fields: ['title'],
      source: 'countdown',
    });
  });

  describe('the smarter-capture fields', () => {
    const full: SuggestionDto['fields'] = {
      dueDate: { value: '2026-10-23', reason: 'Friday' },
      priority: null,
      assignee: null,
      title: { value: 'Smart note', reason: 'shorter' },
      reference: null,
      subtasks: null,
      links: null,
      horizon: { value: 'THIS_WEEK', reason: 'this week' },
      visibility: { value: 'PRIVATE', reason: 'personal' },
      tags: { items: ['ops', 'sales', 'travel'], reason: 'board tags' },
      properties: {
        items: [
          { key: 'Customer', value: 'Acme' },
          { key: 'Project', value: 'Relaunch' },
        ],
        reason: 'named',
      },
      description: { value: 'The detail.', reason: 'moved out' },
    };
    const start = async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({ suggestion: dto({ fields: full }) });
      const view = setup();
      act(() => view.result.current.request('n1', []));
      await flush();
      return view;
    };

    it('starts with everything but Private in the change, the cleaned title included', async () => {
      const { result } = await start();
      const mark = result.current.marks.get('n1')!;
      expect(mark.fields).toEqual([
        'dueDate',
        'title',
        'horizon',
        'tags',
        'properties',
        'description',
      ]);
      expect(mark.tags).toEqual([0, 1, 2]);
      expect(mark.properties).toEqual([0, 1]);
      expect(mark.countdownEndsAt).not.toBeNull();
    });

    it('ticking Private stops the countdown, and the title and description go in and out together', async () => {
      const { result } = await start();
      act(() => result.current.setField('n1', 'visibility', true));
      expect(result.current.marks.get('n1')).toMatchObject({ countdownEndsAt: null });
      expect(result.current.marks.get('n1')?.fields).toContain('visibility');
      act(() => result.current.setField('n1', 'title', true));
      expect(result.current.marks.get('n1')?.fields).toEqual(
        expect.arrayContaining(['title', 'description']),
      );
      act(() => result.current.setField('n1', 'title', false));
      expect(result.current.marks.get('n1')?.fields).not.toContain('description');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
      });
      expect(assistantApi.decide).not.toHaveBeenCalled();
    });

    it('setTag and setProperty tick items in and out and send their indexes with the keep', async () => {
      const { result } = await start();
      act(() => result.current.setTag('n1', 1, false));
      act(() => result.current.setProperty('n1', 0, false));
      act(() => result.current.keep('n1', 'click'));
      await flush();
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate', 'title', 'horizon', 'tags', 'properties', 'description'],
        tags: [0, 2],
        properties: [1],
        source: 'click',
      });
    });

    it('the countdown sends the ticked tags and properties, the title, and never Private', async () => {
      const { result } = await start();
      act(() => result.current.setTag('n1', 0, false));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
      });
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate', 'title', 'horizon', 'tags', 'properties', 'description'],
        tags: [1, 2],
        properties: [0, 1],
        source: 'countdown',
      });
      expect(result.current.marks.get('n1')?.phase).toBe('kept');
    });

    it('the last tag out takes the tags out of the change, and one ticked back is that one alone', async () => {
      const { result } = await start();
      for (const i of [0, 1, 2]) act(() => result.current.setTag('n1', i, false));
      expect(result.current.marks.get('n1')?.fields).not.toContain('tags');
      act(() => result.current.setTag('n1', 2, true));
      expect(result.current.marks.get('n1')).toMatchObject({ tags: [2] });
      expect(result.current.marks.get('n1')?.fields).toContain('tags');
    });
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

  it('says "nothing to add" for an empty answer, briefly, then the card is ordinary again', async () => {
    vi.mocked(assistantApi.suggest).mockResolvedValueOnce({ suggestion: null });
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.marks.get('n1')).toMatchObject({
      phase: 'outcome',
      outcome: { kind: 'nothing', canRetry: false },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OUTCOME_FADE_MS);
    });
    expect(result.current.marks.has('n1')).toBe(false);
  });

  it('says the AI is busy when the call fails, until Try again asks once more', async () => {
    vi.mocked(assistantApi.suggest).mockRejectedValueOnce(
      Object.assign(new Error('502'), { status: 502, code: 'ASSISTANT_PROVIDER_ERROR' }),
    );
    const { result } = setup();
    act(() => result.current.request('n1', ['dueDate']));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OUTCOME_FADE_MS * 3);
    });
    expect(result.current.marks.get('n1')).toMatchObject({
      phase: 'outcome',
      outcome: { kind: 'busy', canRetry: true },
    });
    act(() => result.current.retryOutcome('n1'));
    // Try again first waits for the note's saves (none here), then asks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(assistantApi.suggest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(assistantApi.suggest).mock.calls[1]![1]).toMatchObject({
      locked: ['dueDate'],
    });
    expect(result.current.marks.get('n1')?.phase).toBe('pending');
  });

  it('says when the limit lifts, and × takes the line away', async () => {
    vi.mocked(assistantApi.suggest).mockRejectedValueOnce(
      Object.assign(new Error('429'), {
        status: 429,
        code: 'ASSISTANT_DAILY_CAP',
        resetsAt: '2026-10-20T00:00:00Z',
      }),
    );
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    expect(result.current.marks.get('n1')?.outcome).toEqual({
      kind: 'limit',
      code: 'ASSISTANT_DAILY_CAP',
      resetsAt: '2026-10-20T00:00:00Z',
      canRetry: false,
    });
    act(() => result.current.dismissOutcome('n1'));
    expect(result.current.marks.has('n1')).toBe(false);
  });

  it('says "this changed meanwhile" when the keep finds the note changed, then goes', async () => {
    vi.mocked(assistantApi.decide).mockRejectedValueOnce(
      Object.assign(new Error('409'), { status: 409, code: 'STALE_REVISION' }),
    );
    const { result, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => result.current.request('n1', []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
    });
    expect(result.current.marks.get('n1')?.outcome).toMatchObject({ kind: 'changed' });
    expect(invalidate).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OUTCOME_FADE_MS);
    });
    expect(result.current.marks.has('n1')).toBe(false);
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
          horizon: null,
          visibility: null,
          tags: null,
          properties: null,
          description: null,
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
          horizon: null,
          visibility: null,
          tags: null,
          properties: null,
          description: null,
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

  it('shows "asking" at once and calls only once `after` resolves', async () => {
    let release!: () => void;
    const after = () =>
      new Promise<void>((r) => {
        release = r;
      });
    const { result } = setup();
    act(() => result.current.request('n1', ['title'], { after }));
    expect(result.current.marks.get('n1')?.phase).toBe('asking');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(assistantApi.suggest).not.toHaveBeenCalled();
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(assistantApi.suggest).toHaveBeenCalledTimes(1);
    expect(result.current.marks.get('n1')?.phase).toBe('pending');
  });

  it('sends nothing when Esc dismisses a call still waiting for `after`', async () => {
    let release!: () => void;
    const after = () =>
      new Promise<void>((r) => {
        release = r;
      });
    const { result } = setup();
    act(() => result.current.request('n1', [], { after }));
    act(() => result.current.discard('n1', 'esc'));
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(assistantApi.suggest).not.toHaveBeenCalled();
    expect(result.current.marks.has('n1')).toBe(false);
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

  it('tries a failing keep twice at most, then says it could not save; Try again resends it', async () => {
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
    expect(result.current.marks.get('n1')?.outcome).toMatchObject({
      kind: 'saveFailed',
      canRetry: true,
    });
    act(() => result.current.retryOutcome('n1'));
    await flush();
    expect(assistantApi.decide).toHaveBeenCalledTimes(3);
    expect(vi.mocked(assistantApi.decide).mock.calls[2]![2]).toMatchObject({ decision: 'keep' });
    expect(result.current.marks.get('n1')?.phase).toBe('kept');

    // A refusal is never retried: it says the note changed.
    vi.mocked(assistantApi.decide).mockRejectedValueOnce(
      Object.assign(new Error('409'), { status: 409, code: 'STALE_REVISION' }),
    );
    vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
      suggestion: dto({ id: 's2', noteId: 'n2' }),
    });
    act(() => result.current.request('n2', []));
    await flush();
    act(() => result.current.keep('n2', 'enter'));
    await flush();
    expect(result.current.marks.get('n2')?.outcome?.kind).toBe('changed');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(KEEP_RETRY_MS * 4);
    });
    expect(assistantApi.decide).toHaveBeenCalledTimes(4);
  });

  it('Try again on a busy line waits for the note’s saves still on their way', async () => {
    vi.mocked(assistantApi.suggest).mockRejectedValueOnce(
      Object.assign(new Error('502'), { status: 502, code: 'ASSISTANT_PROVIDER_ERROR' }),
    );
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    let land!: () => void;
    void enqueueMutation(captureMutation('note:n1'), async () => {
      await new Promise<void>((resolve) => (land = resolve));
      return { data: null, revision: 4 };
    });
    act(() => result.current.retryOutcome('n1'));
    await flush();
    expect(assistantApi.suggest).toHaveBeenCalledTimes(1);
    await act(async () => {
      land();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(assistantApi.suggest).toHaveBeenCalledTimes(2);
  });

  it('a second failed undo still retries as an undo, from the kept state', async () => {
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    act(() => result.current.keep('n1', 'enter'));
    await flush();
    vi.mocked(assistantApi.decide)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockReturnValueOnce(new Promise(() => {}));
    act(() => result.current.undo('n1', 'click'));
    await flush();
    act(() => result.current.retryOutcome('n1'));
    await flush();
    expect(result.current.marks.get('n1')?.outcome?.kind).toBe('saveFailed');
    act(() => result.current.retryOutcome('n1'));
    expect(result.current.marks.get('n1')?.phase).toBe('kept');
  });

  it('says it could not undo, and keeps the values marked until Try again works', async () => {
    const { result } = setup();
    act(() => result.current.request('n1', []));
    await flush();
    act(() => result.current.keep('n1', 'enter'));
    await flush();
    expect(result.current.marks.get('n1')?.phase).toBe('kept');
    vi.mocked(assistantApi.decide).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    act(() => result.current.undo('n1', 'click'));
    await flush();
    expect(result.current.marks.get('n1')?.outcome).toMatchObject({ kind: 'saveFailed' });
    act(() => result.current.retryOutcome('n1'));
    await flush();
    expect(vi.mocked(assistantApi.decide).mock.calls.at(-1)![2]).toMatchObject({
      decision: 'undo',
    });
    expect(result.current.marks.has('n1')).toBe(false);
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

    it('names when the change ⌘Z would undo was kept, and nothing once it is undone (R7)', async () => {
      const { result } = setup();
      expect(result.current.lastKeptAt()).toBeNull();
      act(() => result.current.request('n1', []));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COUNTDOWN_MS);
      });
      expect(result.current.marks.get('n1')?.phase).toBe('kept');
      const at = result.current.lastKeptAt();
      expect(at).not.toBeNull();
      // A Tidy kept from now on is more recent than this change.
      expect(nextKeptStamp()).toBeGreaterThan(at!);
      // The undo's answer lands inside act too, so no update escapes it.
      await act(async () => {
        result.current.undoLast();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.lastKeptAt()).toBeNull();
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
      horizon: null,
      visibility: null,
      tags: null,
      properties: null,
      description: null,
      ...over,
    });
    const DATE = { value: '2026-10-23', reason: 'Friday' };
    const TITLE = { value: 'Quote for Müller', reason: 'shorter' };

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

    // A target deleted or made private after the proposal loaded: the server refuses the keep
    // with 422 LINK_TARGET_INVALID, puts back what it wrote and discards the record (Task 4's
    // completeKeep). A refusal is not sent again; the dot goes and the note is read afresh.
    it('drops the dot without a second try when a ticked link target is refused', async () => {
      vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
        suggestion: dto({
          fields: fields({
            dueDate: DATE,
            links: {
              items: [{ index: 0, noteId: 'b', title: 'B', reason: 'same customer' }],
              reason: 'related',
            },
          }),
        }),
      });
      vi.mocked(assistantApi.decide).mockRejectedValueOnce(
        Object.assign(new Error('422'), { status: 422, code: 'LINK_TARGET_INVALID' }),
      );
      wallybot.autoApply = false;
      const { result, queryClient } = setup();
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      act(() => result.current.request('n1', []));
      await flush();
      act(() => result.current.keep('n1', 'enter'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(KEEP_RETRY_MS * 4);
      });
      expect(assistantApi.decide).toHaveBeenCalledTimes(1);
      expect(assistantApi.decide).toHaveBeenCalledWith(BOARD, 's1', {
        decision: 'keep',
        fields: ['dueDate', 'links'],
        links: [0],
        source: 'enter',
      });
      expect(result.current.marks.has('n1')).toBe(false);
      expect(invalidate).toHaveBeenCalled();
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

    it('the last field out leaves the change waiting with no ring, so a row can come back', async () => {
      for (const take of ['untick', 'remove'] as const) {
        vi.mocked(assistantApi.decide).mockClear();
        vi.mocked(assistantApi.suggest).mockResolvedValueOnce({
          suggestion: dto({ fields: fields({ dueDate: DATE, title: TITLE }) }),
        });
        const { result, unmount } = setup();
        act(() => result.current.request('n1', []));
        await flush();
        // One press at a time, as a person makes them.
        for (const field of ['dueDate', 'title'] as const)
          act(() =>
            take === 'untick'
              ? result.current.setField('n1', field, false)
              : result.current.remove('n1', field),
          );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
        });
        expect(assistantApi.decide, take).not.toHaveBeenCalled();
        expect(result.current.marks.get('n1'), take).toMatchObject({
          phase: 'pending',
          fields: [],
          countdownEndsAt: null,
        });
        act(() => result.current.setField('n1', 'dueDate', true));
        expect(result.current.marks.get('n1')?.fields, take).toEqual(['dueDate']);
        unmount();
      }
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
            tags: [],
            properties: [],
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
