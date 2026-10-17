import { describe, expect, it, vi } from 'vitest';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { PendingProps } from './pendingProps';
import { proposedTitle, proposedValues } from './pendingProps';
import type { SuggestionMark } from './useSuggestions';

const TITLE = { value: 'Angebot an Müller', reason: 'kürzer' };
const REFERENCE = { key: 'Kunde', value: 'Müller GmbH', reason: 'Kunde genannt' };
const STEPS = { items: ['a', 'b', 'c'], reason: 'Schritte' };

/** A pending mark whose proposal holds a date, a title, a reference and three steps. */
const mark = (over: Partial<SuggestionMark> = {}): SuggestionMark => {
  const base = makeSuggestionMark();
  return {
    ...base,
    suggestion: {
      ...base.suggestion!,
      fields: {
        ...base.suggestion!.fields,
        title: TITLE,
        reference: REFERENCE,
        subtasks: STEPS,
      },
    },
    fields: ['dueDate', 'reference', 'subtasks'],
    subtasks: [0, 1, 2],
    ...over,
  };
};
const pending = (m: SuggestionMark): PendingProps => ({
  mark: m,
  onKeep: vi.fn(),
  onDiscard: vi.fn(),
  onUndo: vi.fn(),
  onRemove: vi.fn(),
  onSetField: vi.fn(),
  onSetSubtask: vi.fn(),
  onPause: vi.fn(),
});

describe('proposedTitle', () => {
  it('offers the title ticked or not, never while asking, and not once turned down', () => {
    expect(proposedTitle(mark())).toEqual(TITLE);
    expect(proposedTitle(mark({ fields: ['dueDate', 'title'] }))).toEqual(TITLE);
    expect(proposedTitle(mark({ phase: 'asking' }))).toBeNull();
    expect(proposedTitle(mark({ titleDismissed: true }))).toBeNull();
  });
});

describe('proposedValues', () => {
  it('puts only the ticked fields in their places; the offer itself stays on the record', () => {
    const note = makeNote();
    const all = proposedValues(note, pending(mark({ subtasks: [0, 2] })));
    expect(all.title).toBeNull();
    expect(all.reference).toEqual(REFERENCE);
    expect(all.subtasks).toEqual({ ...STEPS, kept: [0, 2] });

    // Unticked rows leave the card's places; the review reads what is offered from
    // `mark.suggestion.fields` and what is ticked from `mark.fields` and `mark.subtasks`.
    const unticked = mark({ fields: ['dueDate'], subtasks: [] });
    const shown = proposedValues(note, pending(unticked));
    expect(shown.reference).toBeNull();
    expect(shown.subtasks).toBeNull();
    expect(unticked.suggestion?.fields.reference).toEqual(REFERENCE);
    expect(unticked.suggestion?.fields.subtasks).toEqual(STEPS);
  });
});
