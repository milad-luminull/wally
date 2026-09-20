import { describe, expect, it } from 'vitest';
import { FREE_CANVAS_WIDTH, NOTE_CARD_HEIGHT, NOTE_CARD_WIDTH } from '@wally/shared';
import { nextFreeNotePosition } from './notePlacement';

interface Placed {
  freeX: number;
  freeY: number;
}

function overlaps(a: Placed, b: Placed) {
  return (
    a.freeX < b.freeX + NOTE_CARD_WIDTH &&
    b.freeX < a.freeX + NOTE_CARD_WIDTH &&
    a.freeY < b.freeY + NOTE_CARD_HEIGHT &&
    b.freeY < a.freeY + NOTE_CARD_HEIGHT
  );
}

describe('nextFreeNotePosition', () => {
  it('keeps the first note off the canvas corner', () => {
    const first = nextFreeNotePosition([]);
    expect(first.freeX).toBeGreaterThan(0);
    expect(first.freeY).toBeGreaterThan(0);
  });

  it('never returns a position that overlaps an existing note', () => {
    const placed: Placed[] = [];
    for (let i = 0; i < 25; i++) {
      const next = nextFreeNotePosition(placed);
      for (const existing of placed) {
        expect(overlaps(next, existing)).toBe(false);
      }
      placed.push(next);
    }
  });

  it('fills across before wrapping to a new row', () => {
    const first = nextFreeNotePosition([]);
    const second = nextFreeNotePosition([first]);

    expect(second.freeY).toBe(first.freeY);
    expect(second.freeX).toBeGreaterThan(first.freeX);
  });

  it('wraps to a new row instead of running off the canvas', () => {
    const placed: Placed[] = [];
    for (let i = 0; i < 40; i++) placed.push(nextFreeNotePosition(placed));

    const wrapped = placed.filter((p) => p.freeY > placed[0]!.freeY);
    expect(wrapped.length).toBeGreaterThan(0);
    for (const p of placed) {
      expect(p.freeX).toBeLessThanOrEqual(FREE_CANVAS_WIDTH - NOTE_CARD_WIDTH);
    }
  });

  it('reuses a gap left by a note that moved away', () => {
    const first = nextFreeNotePosition([]);
    const second = nextFreeNotePosition([first]);
    // Only the second slot is occupied — the first is free again.
    expect(nextFreeNotePosition([second])).toEqual(first);
  });
});
