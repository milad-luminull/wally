import type { BoardAxis, BoardView } from '../hooks/useBoardViewState';

/**
 * Whether the board's Tidy is there at all: the horizon wall of a board whose assistant is on
 * (0005-wallybot-inline.md §3.5, plan R2, R4, R10). Off, the controller lets a pending batch go and
 * the wall gets neither the bar nor the marks, so no strip is reserved and no priority card
 * shows where a horizon batch would send it.
 */
export function tidyOnWall(assistantEnabled: boolean, view: BoardView, axis: BoardAxis): boolean {
  return assistantEnabled && view === 'wand' && axis === 'horizon';
}
