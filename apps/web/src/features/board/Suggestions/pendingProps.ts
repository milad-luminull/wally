import type { KeyboardEvent } from 'react';
import type { NoteDto, SuggestionFieldKey, SuggestionFields } from '@wally/shared';
import { parseIsoDate } from '@/i18n/dates';
import type { SuggestionMark } from './useSuggestions';

/** What a card or row needs to draw and report a pending change; the views build it from the controller. */
export interface PendingProps {
  mark: SuggestionMark;
  /** Enter on the card or row, or a click on a button: recorded with the decision (§4). */
  onKeep: (source: 'enter' | 'click') => void;
  onDiscard: () => void;
  /** Esc on the card or row, or a click on an Undo. */
  onUndo: (source: 'esc' | 'click') => void;
  onRemove: (field: SuggestionFieldKey) => void;
  /** Ticks a proposed field into the change or out of it (the review's rows, the title line). */
  onSetField: (field: SuggestionFieldKey, on: boolean) => void;
  /** Ticks one proposed step in or out, by its index. */
  onSetSubtask: (index: number, on: boolean) => void;
  onPause: (paused: boolean) => void;
}

/**
 * Enter keeps, Esc discards (pending) or undoes (kept). True when the key was taken. Enter on a
 * change that holds nothing to keep (an offered title nobody ticked, plan R2) is not taken: it
 * goes on to the card or row as it would without a change.
 */
export function pendingKeys(event: KeyboardEvent, pending: PendingProps | undefined): boolean {
  if (!pending || event.nativeEvent.isComposing) return false;
  const { phase, fields } = pending.mark;
  if (event.key === 'Enter' && phase === 'pending' && fields.length > 0) {
    event.preventDefault();
    event.stopPropagation();
    pending.onKeep('enter');
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
    pending.onUndo('esc');
    return true;
  }
  return false;
}

type Proposed<K extends SuggestionFieldKey> = NonNullable<SuggestionFields[K]>;
type ProposedValues = {
  [K in Exclude<SuggestionFieldKey, 'subtasks'>]: Proposed<K> | null;
} & {
  /** The proposed steps, with the indexes still ticked. */
  subtasks: (Proposed<'subtasks'> & { kept: number[] }) | null;
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
 * note shows a lock, never an assignee. The reference shows only on a note without properties
 * and the steps only on a note without subtasks (R7). The title is a second line beside the
 * person's own, so it shows whatever the note's title is, once ticked (R2).
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
    title: has('title') ? fields.title : null,
    reference:
      has('reference') && Object.keys(note.customFields).length === 0 ? fields.reference : null,
    subtasks:
      has('subtasks') && note.subtaskSummary.total === 0 && fields.subtasks
        ? { ...fields.subtasks, kept: mark.subtasks }
        : null,
  };
}

/**
 * The title a pending change offers, ticked or not: the card and the review show the line in
 * both states, and it counts as taken only while `title` is in the mark's fields. Once the
 * person chose "use mine" (the line's ×), nothing is offered any more (R2).
 */
export function proposedTitle(mark: SuggestionMark): Proposed<'title'> | null {
  if (mark.phase === 'asking' || mark.titleDismissed) return null;
  return mark.suggestion?.fields.title ?? null;
}

/** A proposed due date as the card shows it: weekday and day, in the reader's language. */
export function proposedDateLabel(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(parseIsoDate(iso));
}
