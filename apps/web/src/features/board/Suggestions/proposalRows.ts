import type { SuggestionFieldKey, UserSummary } from '@wally/shared';
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
  /** Whether the row is in the change: kept by Keep (and, unless opt-in, by the countdown). */
  on: boolean;
  reason: string;
} & (
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
 * The rows of a pending change, in the order the card lists them: date, horizon, priority,
 * person, Private, properties, tags, steps, related notes. The title and its description are
 * not rows: they stay on the title line, a second version beside the person's own (R2).
 * A record from before smarter capture shows its one reference as a property row.
 */
export function proposalRows(mark: SuggestionMark): ProposalRow[] {
  if (mark.phase === 'asking' || !mark.suggestion) return [];
  const { fields } = mark.suggestion;
  const has = (key: SuggestionFieldKey) => mark.fields.includes(key);
  const rows: ProposalRow[] = [];
  if (fields.dueDate)
    rows.push({
      id: 'dueDate',
      field: 'dueDate',
      on: has('dueDate'),
      reason: fields.dueDate.reason,
      kind: 'date',
      iso: fields.dueDate.value,
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
  if (fields.assignee)
    rows.push({
      id: 'assignee',
      field: 'assignee',
      on: has('assignee'),
      reason: fields.assignee.reason,
      kind: 'person',
      user: fields.assignee.value,
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
  return rows;
}
