import { describe, expect, it, vi } from 'vitest';
import { nextKeptStamp, undoMostRecent, type KeptUndo } from './keptOrder';

function kept(
  at: number | null,
  undone = at !== null,
): KeptUndo & { undoLast: ReturnType<typeof vi.fn> } {
  return { lastKeptAt: () => at, undoLast: vi.fn(() => undone) };
}

describe('nextKeptStamp', () => {
  it('hands out a later stamp every time', () => {
    const first = nextKeptStamp();
    expect(nextKeptStamp()).toBeGreaterThan(first);
  });
});

describe('undoMostRecent (⌘Z, plan R7)', () => {
  it('undoes the tidy batch when it was kept after the fill-in', () => {
    const suggestions = kept(1);
    const tidy = kept(2);
    expect(undoMostRecent([suggestions, tidy])).toBe(true);
    expect(tidy.undoLast).toHaveBeenCalledTimes(1);
    expect(suggestions.undoLast).not.toHaveBeenCalled();
  });

  it('undoes the fill-in when it was kept after the tidy batch', () => {
    const suggestions = kept(3);
    const tidy = kept(2);
    expect(undoMostRecent([suggestions, tidy])).toBe(true);
    expect(suggestions.undoLast).toHaveBeenCalledTimes(1);
    expect(tidy.undoLast).not.toHaveBeenCalled();
  });

  it('undoes whichever is still in its window, and leaves the key alone when none is', () => {
    const tidy = kept(2);
    expect(undoMostRecent([kept(null), tidy])).toBe(true);
    expect(tidy.undoLast).toHaveBeenCalledTimes(1);
    expect(undoMostRecent([kept(null), kept(null)])).toBe(false);
  });

  it('falls back to the older keep when the newer one can no longer be undone', () => {
    const suggestions = kept(1);
    const tidy = kept(2, false);
    expect(undoMostRecent([suggestions, tidy])).toBe(true);
    expect(suggestions.undoLast).toHaveBeenCalledTimes(1);
  });
});
