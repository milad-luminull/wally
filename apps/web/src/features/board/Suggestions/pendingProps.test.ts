import { describe, expect, it, vi } from 'vitest';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { KeyboardEvent } from 'react';
import type { PendingProps } from './pendingProps';
import { pendingKeys, proposedTitle, proposedValues } from './pendingProps';
import type { SuggestionMark } from './useSuggestions';

const TITLE = { value: 'Quote for Müller', reason: 'shorter' };
const REFERENCE = { key: 'Customer', value: 'Müller GmbH', reason: 'customer named' };
const STEPS = { items: ['a', 'b', 'c'], reason: 'steps' };

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
  onSetLink: vi.fn(),
  onSetTag: vi.fn(),
  onSetProperty: vi.fn(),
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

describe('proposedValues, place by place', () => {
  const kept = (revision: number) => {
    const m = mark({ phase: 'kept', countdownEndsAt: null });
    return mark({
      phase: 'kept',
      countdownEndsAt: null,
      suggestion: {
        ...m.suggestion!,
        status: 'KEPT',
        kept: {
          fields: ['dueDate', 'reference', 'subtasks'],
          subtasks: [0, 1, 2],
          links: [],
          tags: [],
          properties: [],
          revision,
        },
      },
    });
  };

  it('shows nothing while asking, or without a proposal', () => {
    const note = makeNote();
    const none = {
      dueDate: null,
      priority: null,
      assignee: null,
      title: null,
      reference: null,
      subtasks: null,
      links: null,
      horizon: null,
      visibility: null,
      tags: null,
      properties: null,
      description: null,
    };
    expect(proposedValues(note, pending(mark({ phase: 'asking' })))).toEqual(none);
    expect(proposedValues(note, pending(mark({ suggestion: null })))).toEqual(none);
    expect(proposedValues(note, undefined)).toEqual(none);
  });

  /** A note with room for every proposal: no date, no priority, nobody, no property, no step. */
  const empty = (over: Parameters<typeof makeNote>[0] = {}) =>
    makeNote({ dueDate: null, priority: 'MITTEL', assignee: null, ...over });

  it('keeps the kept values in place until the refetched note reaches the kept revision', () => {
    const before = proposedValues(empty({ revision: 2 }), pending(kept(5)));
    expect(before.dueDate).toEqual({ value: '2026-10-23', reason: 'Friday' });
    expect(before.reference).toEqual(REFERENCE);
    expect(before.subtasks).toEqual({ ...STEPS, kept: [0, 1, 2] });
    const after = proposedValues(empty({ revision: 5 }), pending(kept(5)));
    expect(after.dueDate).toBeNull();
    expect(after.reference).toBeNull();
    expect(after.subtasks).toBeNull();
  });

  it('never covers what the note holds: done, private, a property or a step of its own', () => {
    const all = pending(
      mark({ fields: ['dueDate', 'priority', 'assignee', 'title', 'reference', 'subtasks'] }),
    );
    const room = proposedValues(empty(), all);
    expect(room.dueDate).not.toBeNull();
    expect(room.priority).not.toBeNull();
    expect(room.assignee).not.toBeNull();
    expect(room.reference).toEqual(REFERENCE);
    expect(room.subtasks).not.toBeNull();

    const done = proposedValues(empty({ status: 'DONE' }), all);
    expect(done.dueDate).toBeNull();
    expect(done.priority).toBeNull();
    const own = proposedValues(empty({ dueDate: '2026-11-01', priority: 'NIEDRIG' }), all);
    expect(own.dueDate).toBeNull();
    expect(own.priority).toBeNull();
    expect(proposedValues(empty({ visibility: 'PRIVATE' }), all).assignee).toBeNull();
    expect(proposedValues(empty({ customFields: { Project: 'X' } }), all).reference).toBeNull();
    expect(
      proposedValues(empty({ subtaskSummary: { done: 0, total: 1 } }), all).subtasks,
    ).toBeNull();
    // The title is a second line beside the person's own: once ticked it shows whatever the
    // note's title is.
    expect(proposedValues(empty({ title: 'My own' }), all).title).toEqual(TITLE);
  });

  it('offers the proposed links, with the ticked indexes, only on a note without links', () => {
    const links = {
      items: [
        { index: 0, noteId: 'b', title: 'B', reason: 'same' },
        { index: 1, noteId: 'c', title: 'C', reason: 'same' },
      ],
      reason: 'r',
    };
    const m = makeSuggestionMark({ fields: ['links'], links: [1] });
    m.suggestion!.fields.links = links;
    const p = pending(m);
    expect(proposedValues(makeNote({ links: [] }), p).links).toEqual({ ...links, kept: [1] });
    expect(proposedValues(makeNote({ links: ['z'] }), p).links).toBeNull();
    // Unticked as a whole: nothing in its place.
    expect(proposedValues(makeNote({ links: [] }), pending({ ...m, fields: [] })).links).toBeNull();
  });
});

describe('pendingKeys', () => {
  const key = (k: string) => {
    const event = {
      key: k,
      nativeEvent: { isComposing: false },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    return event as unknown as KeyboardEvent & typeof event;
  };

  it('keeps on Enter and undoes on Esc, saying which key it was', () => {
    const p = pending(mark());
    expect(pendingKeys(key('Enter'), p)).toBe(true);
    expect(p.onKeep).toHaveBeenCalledWith('enter');
    const k = pending(mark({ phase: 'kept', countdownEndsAt: null }));
    expect(pendingKeys(key('Escape'), k)).toBe(true);
    expect(k.onUndo).toHaveBeenCalledWith('esc');
  });

  it('lets Enter through when nothing but an unticked title is offered', () => {
    const p = pending(mark({ fields: [], subtasks: [] }));
    const enter = key('Enter');
    expect(pendingKeys(enter, p)).toBe(false);
    expect(enter.preventDefault).not.toHaveBeenCalled();
    expect(p.onKeep).not.toHaveBeenCalled();
    // Esc still discards the offer.
    expect(pendingKeys(key('Escape'), p)).toBe(true);
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
  });
});
