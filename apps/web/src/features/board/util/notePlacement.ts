import { FREE_CANVAS_HEIGHT, FREE_CANVAS_WIDTH, NOTE_CARD_HEIGHT, NOTE_CARD_WIDTH } from '@wally/shared';

/** Keeps the first card clear of the canvas corner, so it reads as placed rather than stuck. */
const MARGIN = 32;
const GAP = 24;

interface PlacedNote {
  freeX: number;
  freeY: number;
}

/**
 * Where to put a note created without a position of its own — the TopBar button and the
 * per-zone "add" affordances, neither of which has a cursor to place it under (unlike
 * double-clicking the canvas, which passes real coordinates).
 *
 * Walks a left-to-right, top-to-bottom grid and returns the first slot whose card-sized
 * rectangle clears every existing note. Without this every such note took the schema
 * default of {0, 0}: the first one sat in the canvas corner looking like a layout bug, and
 * each one after it landed exactly on top of the last.
 *
 * Existing notes are free to sit anywhere once dragged, so candidates are tested by actual
 * rectangle overlap rather than by grid occupancy — a note dragged half-way between two
 * slots still blocks both. Gaps left behind by notes that moved away get reused.
 */
export function nextFreeNotePosition(notes: readonly PlacedNote[]): PlacedNote {
  const stepX = NOTE_CARD_WIDTH + GAP;
  const stepY = NOTE_CARD_HEIGHT + GAP;
  const maxX = FREE_CANVAS_WIDTH - NOTE_CARD_WIDTH;
  const maxY = FREE_CANVAS_HEIGHT - NOTE_CARD_HEIGHT;

  for (let freeY = MARGIN; freeY <= maxY; freeY += stepY) {
    for (let freeX = MARGIN; freeX <= maxX; freeX += stepX) {
      const clear = notes.every(
        (n) =>
          freeX + NOTE_CARD_WIDTH <= n.freeX ||
          n.freeX + NOTE_CARD_WIDTH <= freeX ||
          freeY + NOTE_CARD_HEIGHT <= n.freeY ||
          n.freeY + NOTE_CARD_HEIGHT <= freeY,
      );
      if (clear) return { freeX, freeY };
    }
  }

  // Canvas is wall-to-wall notes. Overlapping the first slot beats placing a card outside
  // the scrollable area, where it could not be reached at all.
  return { freeX: MARGIN, freeY: MARGIN };
}
