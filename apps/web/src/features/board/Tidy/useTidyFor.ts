import { useCallback } from 'react';
import type { TidyProps } from './tidyProps';
import type { TidyController } from './useTidy';

/** Builds what a card needs for its part in the batch, from the board's one controller. */
export function useTidyFor(tidy: TidyController): (noteId: string) => TidyProps | undefined {
  return useCallback(
    (noteId: string) => {
      const mark = tidy.markFor(noteId);
      if (!mark) return undefined;
      return {
        mark,
        onKeep: (source) => tidy.keep(source),
        onDiscard: () => tidy.discard('esc'),
        onUndo: (source) => tidy.undo(source),
        onRemove: () => tidy.remove(noteId),
      };
    },
    [tidy],
  );
}
