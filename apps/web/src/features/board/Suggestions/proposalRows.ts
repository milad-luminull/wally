import type { NoteDto, SuggestionFieldKey, UserSummary } from '@wally/shared';
import type { SuggestionMark } from './useSuggestions';

/**
 * One line of a pending change's list (the smarter-capture spec §5, after Paper Wall v3):
 * every proposed field or item, in or out of the change. A row out of it shows crossed out,
 * so it can be brought back.
 */
export type ProposalRow = {
  /** Stable within one proposal: the field, and the item's index for a list. */
  id: string;
  field: SuggestionFieldKey;
  /** The item's index in the proposal, for steps, links, tags and properties. */
  index?: number;
  /** Whether the row is in the change: kept by Keep (and, unless Private, by the countdown). */
  on: boolean;
  /** A field the person typed (a chip): already on the note, shown, never toggled here. */
  fixed?: boolean;
  reason: string;
} & (
  | { kind: 'title'; value: string }
  | { kind: 'date'; iso: string }
  | { kind: 'horizon'; value: 'DIESE_WOCHE' | 'SPAETER' }
  | { kind: 'priority'; value: 'HOCH' | 'NIEDRIG' }
  | { kind: 'person'; user: UserSummary }
  | { kind: 'private' }
  | { kind: 'property'; key: string; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'step'; text: string }
  | { kind: 'link'; title: string }
);

/**
 * The rows of a pending change, in the order the card lists them (Paper Wall v3): the cleaned
 * title, date, horizon, priority, person, Private, properties, tags, related notes, then the
 * steps (drawn as a checklist). Fields the person typed (`suggestion.typed`) are rows too, with
 * the note's own values, fixed. A record from before smarter capture shows its one reference as
 * a property row.
 */
export function proposalRows(note: NoteDto, mark: SuggestionMark): ProposalRow[] {
  if (mark.phase === 'asking' || !mark.suggestion) return [];
  const { fields, typed } = mark.suggestion;
  const has = (key: SuggestionFieldKey) => mark.fields.includes(key);
  const wasTyped = (key: SuggestionFieldKey) => typed.includes(key);
  const rows: ProposalRow[] = [];
  if (fields.title)
    rows.push({
      id: 'title',
      field: 'title',
      on: has('title'),
      reason: fields.title.reason,
      kind: 'title',
      value: fields.title.value,
    });
  if (fields.dueDate)
    rows.push({
      id: 'dueDate',
      field: 'dueDate',
      on: has('dueDate'),
      reason: fields.dueDate.reason,
      kind: 'date',
      iso: fields.dueDate.value,
    });
  else if (wasTyped('dueDate') && note.dueDate)
    rows.push({
      id: 'dueDate',
      field: 'dueDate',
      on: true,
      fixed: true,
      reason: '',
      kind: 'date',
      iso: note.dueDate,
    });
  if (fields.horizon)
    rows.push({
      id: 'horizon',
      field: 'horizon',
      on: has('horizon'),
      reason: fields.horizon.reason,
      kind: 'horizon',
      value: fields.horizon.value,
    });
  if (fields.priority)
    rows.push({
      id: 'priority',
      field: 'priority',
      on: has('priority'),
      reason: fields.priority.reason,
      kind: 'priority',
      value: fields.priority.value,
    });
  else if (wasTyped('priority') && note.priority !== 'MITTEL')
    rows.push({
      id: 'priority',
      field: 'priority',
      on: true,
      fixed: true,
      reason: '',
      kind: 'priority',
      value: note.priority,
    });
  if (fields.assignee)
    rows.push({
      id: 'assignee',
      field: 'assignee',
      on: has('assignee'),
      reason: fields.assignee.reason,
      kind: 'person',
      user: fields.assignee.value,
    });
  else if (wasTyped('assignee') && note.assignee)
    rows.push({
      id: 'assignee',
      field: 'assignee',
      on: true,
      fixed: true,
      reason: '',
      kind: 'person',
      user: note.assignee,
    });
  if (fields.visibility)
    rows.push({
      id: 'visibility',
      field: 'visibility',
      on: has('visibility'),
      reason: fields.visibility.reason,
      kind: 'private',
    });
  if (fields.reference)
    rows.push({
      id: 'reference',
      field: 'reference',
      on: has('reference'),
      reason: fields.reference.reason,
      kind: 'property',
      key: fields.reference.key,
      value: fields.reference.value,
    });
  fields.properties?.items.forEach((item, index) =>
    rows.push({
      id: `properties-${index}`,
      field: 'properties',
      index,
      on: has('properties') && mark.properties.includes(index),
      reason: fields.properties!.reason,
      kind: 'property',
      key: item.key,
      value: item.value,
    }),
  );
  fields.tags?.items.forEach((value, index) =>
    rows.push({
      id: `tags-${index}`,
      field: 'tags',
      index,
      on: has('tags') && mark.tags.includes(index),
      reason: fields.tags!.reason,
      kind: 'tag',
      value,
    }),
  );
  // A link is named by its stored index: one whose target dropped out leaves a gap.
  fields.links?.items.forEach((item) =>
    rows.push({
      id: `links-${item.index}`,
      field: 'links',
      index: item.index,
      on: has('links') && mark.links.includes(item.index),
      reason: item.reason,
      kind: 'link',
      title: item.title,
    }),
  );
  fields.subtasks?.items.forEach((text, index) =>
    rows.push({
      id: `subtasks-${index}`,
      field: 'subtasks',
      index,
      on: has('subtasks') && mark.subtasks.includes(index),
      reason: fields.subtasks!.reason,
      kind: 'step',
      text,
    }),
  );
  return rows;
}
