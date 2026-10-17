import type { KeyboardEvent } from 'react';
import type { NoteDto, SuggestionDto, SuggestionFieldKey } from '@wally/shared';
import { parseIsoDate } from '@/i18n/dates';
import type { SuggestionMark } from './useSuggestions';

/** What a card or row needs to draw and report a pending change; the views build it from the controller. */
export interface PendingProps {
  mark: SuggestionMark;
  onKeep: () => void;
  onDiscard: () => void;
  onUndo: () => void;
  onRemove: (field: SuggestionFieldKey) => void;
  onPause: (paused: boolean) => void;
}

/** Enter keeps, Esc discards (pending) or undoes (kept). True when the key was taken. */
export function pendingKeys(event: KeyboardEvent, pending: PendingProps | undefined): boolean {
  if (!pending || event.nativeEvent.isComposing) return false;
  const { phase } = pending.mark;
  if (event.key === 'Enter' && phase === 'pending') {
    event.preventDefault();
    event.stopPropagation();
    pending.onKeep();
    return true;
  }
  if (event.key === 'Escape' && (phase === 'pending' || phase === 'asking')) {
    event.preventDefault();
    event.stopPropagation();
    pending.onDiscard();
    return true;
  }
  if (event.key === 'Escape' && phase === 'kept') {
    event.preventDefault();
    event.stopPropagation();
    pending.onUndo();
    return true;
  }
  return false;
}

type ProposedValues = {
  [K in SuggestionFieldKey]: NonNullable<SuggestionDto['fields'][K]> | null;
};
const NONE: ProposedValues = {
  dueDate: null,
  priority: null,
  assignee: null,
  title: null,
  reference: null,
  subtasks: null,
};

/**
 * The proposed values a note shows in their places: only for the fields still in the change,
 * and only where the note has nothing of its own (plan R3), so a value the person set is never
 * covered. A done note shows no due date or priority, so none is proposed there; a private
 * note shows a lock, never an assignee.
 *
 * Once kept, the kept values stay in their places until the refetched note carries them (its
 * revision reaches the one the keep produced), so a date, a priority or a person never blinks
 * out for the round trip; from then on the note's own values show.
 */
export function proposedValues(note: NoteDto, pending: PendingProps | undefined): ProposedValues {
  const mark = pending?.mark;
  if (!mark?.suggestion || mark.phase === 'asking') return NONE;
  if (mark.phase === 'kept') {
    const kept = mark.suggestion.kept;
    if (!kept || note.revision >= kept.revision) return NONE;
  }
  const { fields } = mark.suggestion;
  const open = note.status !== 'DONE';
  const has = (key: SuggestionFieldKey) => mark.fields.includes(key);
  return {
    dueDate: has('dueDate') && open && note.dueDate === null ? fields.dueDate : null,
    priority: has('priority') && open && note.priority === 'MITTEL' ? fields.priority : null,
    assignee:
      has('assignee') && note.visibility !== 'PRIVATE' && note.assignee === null
        ? fields.assignee
        : null,
    // The title line, the reference and the subtasks are drawn by the review's own slices.
    title: null,
    reference: null,
    subtasks: null,
  };
}

/** A proposed due date as the card shows it: weekday and day, in the reader's language. */
export function proposedDateLabel(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(parseIsoDate(iso));
}
