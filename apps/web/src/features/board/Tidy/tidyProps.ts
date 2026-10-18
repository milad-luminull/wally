import type { KeyboardEvent } from 'react';
import type { TidyMark } from './useTidy';

/** What a card needs to draw and report a note's part in the batch (plan R6, R7). */
export interface TidyProps {
  mark: TidyMark;
  /** Enter on the card keeps the whole batch. */
  onKeep: (source: 'enter') => void;
  /** Esc on a card still pending discards the whole batch. */
  onDiscard: () => void;
  /** Esc on a moved card, or its Undo, puts the whole batch back. */
  onUndo: (source: 'esc' | 'click') => void;
  /** The ×: this note stays where it is; the last one out discards. */
  onRemove: () => void;
}

/** Enter keeps, Esc discards (pending) or undoes (kept). True when the key was taken. */
export function tidyKeys(event: KeyboardEvent, tidy: TidyProps | undefined): boolean {
  if (!tidy || event.nativeEvent.isComposing) return false;
  if (event.key === 'Enter' && tidy.mark.phase === 'pending') {
    event.preventDefault();
    event.stopPropagation();
    tidy.onKeep('enter');
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (tidy.mark.phase === 'pending') tidy.onDiscard();
    else tidy.onUndo('esc');
    return true;
  }
  return false;
}
