import type { NoteCreateInput, NoteDto } from '@wally/shared';
import type { BoardAxis, BoardView } from '../hooks/useBoardViewState';
import { defaultZoneKey } from '../util/noteDerived';
import { nextFreeNotePosition } from '../util/notePlacement';

/** Where a note written in the box lands: the spot it was opened at, or the board's default. */
export type CapturePlacement =
  | { kind: 'free'; x: number; y: number }
  | {
      kind: 'zone';
      axis: 'horizon' | 'priority';
      key: string;
      at: { freeX: number; freeY: number };
      /** The person chose this zone (a click in it), rather than the New note button's default. */
      picked?: boolean;
    }
  | { kind: 'list' };

/** How far below the one before it each further note from one message lands on the free wall. */
export const NOTE_STACK_GAP = 112;

export function placementInput(
  placement: CapturePlacement,
  notes: NoteDto[],
): Partial<NoteCreateInput> {
  switch (placement.kind) {
    case 'free':
      return { freeX: placement.x, freeY: placement.y };
    case 'zone':
      return placement.axis === 'horizon'
        ? { ...nextFreeNotePosition(notes), horizon: placement.key as NoteCreateInput['horizon'] }
        : {
            ...nextFreeNotePosition(notes),
            priority: placement.key as NoteCreateInput['priority'],
          };
    case 'list':
      return nextFreeNotePosition(notes);
  }
}

/** The `index`-th note of one message: one under another at a free spot, else the same place. */
export function placementAt(placement: CapturePlacement, index: number): CapturePlacement {
  return placement.kind === 'free' && index > 0
    ? { ...placement, y: placement.y + index * NOTE_STACK_GAP }
    : placement;
}

/** Where the docked box writes: what the New note button chose before the box. */
export function dockedPlacement(
  view: BoardView,
  axis: BoardAxis,
  notes: NoteDto[],
): CapturePlacement {
  if (view === 'list') return { kind: 'list' };
  if (axis === 'free') {
    const at = nextFreeNotePosition(notes);
    return { kind: 'free', x: at.freeX, y: at.freeY };
  }
  return { kind: 'zone', axis, key: defaultZoneKey(axis), at: nextFreeNotePosition(notes) };
}
