import { describe, expect, it } from 'vitest';
import { NOTE_CARD_HEIGHT, NOTE_CARD_WIDTH } from '@wally/shared';
import { nextFreeNotePosition } from '../util/notePlacement';
import { ASK_CARD_MAX_HEIGHT, ASK_CARD_WIDTH } from './AskCard';
import { placementsTaken } from './askSlot';

const NOTE = { freeX: 600, freeY: 400 };

function overlapsAnswer(at: { freeX: number; freeY: number }, x: number, y: number) {
  return (
    at.freeX < x + ASK_CARD_WIDTH &&
    x < at.freeX + NOTE_CARD_WIDTH &&
    at.freeY < y + ASK_CARD_MAX_HEIGHT &&
    y < at.freeY + NOTE_CARD_HEIGHT
  );
}

describe('placementsTaken', () => {
  it('is the notes alone without an answer on the canvas', () => {
    expect(placementsTaken([NOTE], null)).toEqual([NOTE]);
    expect(placementsTaken([NOTE], { kind: 'list' })).toEqual([NOTE]);
    expect(
      placementsTaken([NOTE], {
        kind: 'zone',
        axis: 'horizon',
        key: 'TODAY',
        at: { freeX: 32, freeY: 32 },
      }),
    ).toEqual([NOTE]);
  });

  it('counts the whole answer card as taken, so the next note is placed clear of it', () => {
    // The question was written in the first free slot; its draft note is gone, so the slot
    // reads as free to the notes alone.
    const first = nextFreeNotePosition([]);
    const answer = { kind: 'free', x: first.freeX, y: first.freeY } as const;
    expect(nextFreeNotePosition([])).toEqual(first);
    const next = nextFreeNotePosition(placementsTaken([], answer));
    expect(overlapsAnswer(next, answer.x, answer.y)).toBe(false);
  });

  it('keeps the notes it was given', () => {
    const taken = placementsTaken([NOTE], { kind: 'free', x: 32, y: 32 });
    expect(taken).toContainEqual(NOTE);
    expect(taken.length).toBeGreaterThan(1);
  });
});
