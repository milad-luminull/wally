import type { BoardAxis } from '../hooks/useBoardViewState';

/** Droppable-region id convention consumed by WallView's onDragEnd. */
export function zoneDroppableId(axis: BoardAxis, key: string) {
  return `zone:${axis}:${key}`;
}
