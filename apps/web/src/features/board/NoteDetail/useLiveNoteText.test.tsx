import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLiveNoteText } from './useLiveNoteText';
import {
  captureMutation,
  discardRecovery,
  enqueueMutation,
  getRecoveries,
  resetMutationSession,
} from '@/lib/mutationQueue';

beforeEach(() => {
  vi.useFakeTimers();
  resetMutationSession();
});
afterEach(() => vi.useRealTimers());
it('keeps failed text across a server refetch instead of marking it saved', async () => {
  const save = vi.fn().mockRejectedValue(new Error('conflict'));
  const { result, rerender } = renderHook(
    ({ serverValue }) =>
      useLiveNoteText({ serverValue, normalize: (x) => x, onLocalChange: () => {}, save }),
    { initialProps: { serverValue: 'Original' } },
  );
  act(() => result.current.onChange('My draft'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  rerender({ serverValue: 'Colleague update' });
  expect(result.current.value).toBe('My draft');
});
it('does not send a delayed autosave after the account changes', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const { result, unmount } = renderHook(() =>
    useLiveNoteText({ serverValue: '', normalize: (x) => x, onLocalChange: () => {}, save }),
  );
  act(() => result.current.onChange('Private draft'));
  resetMutationSession();
  unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(save).not.toHaveBeenCalled();
});

it('saves text typed while an earlier save is in flight after that save acknowledges', async () => {
  let resolve!: () => void;
  const first = new Promise<void>((r) => {
    resolve = r;
  });
  const values: string[] = [];
  const save = async (value: string) => {
    values.push(value);
    if (values.length === 1) await first;
  };
  const { result } = renderHook(() =>
    useLiveNoteText({
      serverValue: 'Original',
      normalize: (x) => x,
      onLocalChange: () => {},
      save,
    }),
  );
  act(() => result.current.onChange('First'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  act(() => result.current.onChange('Second'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(values).toEqual(['First']);
  await act(async () => {
    resolve();
    await first;
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(values).toEqual(['First', 'Second']);
});

it('discarding a failed draft restores current text and cannot resubmit on close', async () => {
  const send = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error('stale'), { code: 'STALE_REVISION' }));
  const { result, rerender, unmount } = renderHook(
    ({ serverValue }) =>
      useLiveNoteText({
        serverValue,
        normalize: (x) => x,
        onLocalChange: () => {},
        capture: () => captureMutation('note:a', { revision: 1 }),
        save: (_value, ticket) => enqueueMutation(ticket!, send),
      }),
    { initialProps: { serverValue: 'Original' } },
  );
  act(() => result.current.onChange('Draft to discard'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  rerender({ serverValue: 'Current server text' });
  act(() => discardRecovery(getRecoveries()[0]!.ticket.operationId));
  expect(result.current.value).toBe('Current server text');
  unmount();
  expect(send).toHaveBeenCalledTimes(1);
});

it('releases a draft when typing returns to the saved value before autosave', async () => {
  const save = vi.fn();
  const { result, rerender } = renderHook(
    ({ serverValue }) =>
      useLiveNoteText({
        serverValue,
        normalize: (x) => x,
        onLocalChange: () => {},
        save,
        draftKey: 'no-op:title',
        capture: () => captureMutation('note:no-op', { revision: 1 }),
      }),
    { initialProps: { serverValue: 'Original' } },
  );
  act(() => {
    result.current.onChange('Other');
    result.current.onChange('Original');
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(save).not.toHaveBeenCalled();
  rerender({ serverValue: 'New remote title' });
  expect(result.current.value).toBe('New remote title');
});

it('discarding after remount clears the currently mounted draft and its pending save', async () => {
  const send = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error('stale'), { code: 'STALE_REVISION' }));
  const options = {
    serverValue: 'Server',
    normalize: (x: string) => x,
    onLocalChange: () => {},
    draftKey: 'remount:title',
    capture: () => captureMutation('note:remount', { revision: 1 }),
    save: (_value: string, ticket?: ReturnType<typeof captureMutation>) =>
      enqueueMutation(ticket!, send),
  };
  const first = renderHook(() => useLiveNoteText(options));
  act(() => first.result.current.onChange('Draft'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  first.unmount();
  const second = renderHook(() => useLiveNoteText(options));
  expect(second.result.current.value).toBe('Draft');
  act(() => discardRecovery(getRecoveries()[0]!.ticket.operationId));
  expect(second.result.current.value).toBe('Server');
  second.unmount();
  expect(send).toHaveBeenCalledTimes(1);
});

it('makes newer text reviewable when the earlier in-flight save fails', async () => {
  let reject!: (error: Error) => void;
  const first = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  const save = (title: string, ticket?: ReturnType<typeof captureMutation>) =>
    enqueueMutation(ticket!, async () => first, {
      action: 'update',
      input: { title },
      loadLatest: async () => ({ data: null, revision: 3 }),
    });
  const { result } = renderHook(() =>
    useLiveNoteText({
      serverValue: 'Original',
      normalize: (x) => x,
      onLocalChange: () => {},
      capture: () => captureMutation('note:pending', { revision: 1 }),
      save,
    }),
  );
  act(() => result.current.onChange('First draft'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  act(() => result.current.onChange('Latest draft'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  await act(async () => {
    reject(new TypeError('lost'));
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(getRecoveries().map((item) => item.description?.input)).toEqual([
    { title: 'First draft' },
    { title: 'Latest draft' },
  ]);
  expect(result.current.value).toBe('Latest draft');
});
