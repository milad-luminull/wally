import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TidyController, TidyMark } from './useTidy';
import { useTidyFor } from './useTidyFor';

const mark: TidyMark = {
  to: 'LATER',
  from: 'TODAY',
  reason: null,
  source: 'date',
  phase: 'pending',
};
function controller(): TidyController {
  return {
    phase: 'pending',
    count: 0,
    moving: 1,
    trackedIds: ['n1'],
    markFor: (noteId) => (noteId === 'n1' ? mark : undefined),
    tidy: vi.fn(),
    keep: vi.fn(),
    discard: vi.fn(),
    undo: vi.fn(),
    undoLast: vi.fn(() => false),
    lastKeptAt: () => null,
    remove: vi.fn(),
    failure: null,
    retry: vi.fn(),
    dismissFailure: vi.fn(),
  };
}

describe('useTidyFor', () => {
  it('gives a note in the batch its mark and the batch’s decisions', () => {
    const tidy = controller();
    const { result } = renderHook(() => useTidyFor(tidy));
    expect(result.current('other')).toBeUndefined();
    const props = result.current('n1')!;
    expect(props.mark).toBe(mark);
    props.onKeep('enter');
    expect(tidy.keep).toHaveBeenCalledWith('enter');
    // Esc on a pending card discards the whole batch, as Esc.
    props.onDiscard();
    expect(tidy.discard).toHaveBeenCalledWith('esc');
    props.onUndo('esc');
    expect(tidy.undo).toHaveBeenCalledWith('esc');
    // The × takes this note out, and only this one.
    props.onRemove();
    expect(tidy.remove).toHaveBeenCalledWith('n1');
    expect(tidy.discard).toHaveBeenCalledTimes(1);
  });
});
