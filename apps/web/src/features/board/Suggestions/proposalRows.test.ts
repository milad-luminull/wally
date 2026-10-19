import { describe, expect, it } from 'vitest';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import { proposalRows } from './proposalRows';

describe('proposalRows', () => {
  const fields = {
    dueDate: { value: '2026-10-23', reason: 'Friday' },
    priority: { value: 'HOCH' as const, reason: 'urgent' },
    assignee: null,
    title: { value: 'Smart note', reason: 'shorter' },
    reference: null,
    subtasks: { items: ['Draft', 'Send'], reason: 'steps' },
    links: {
      items: [{ index: 2, noteId: 'n9', title: 'Acme renewal', reason: 'Acme' }],
      reason: 'r',
    },
    horizon: { value: 'DIESE_WOCHE' as const, reason: 'this week' },
    visibility: { value: 'PRIVATE' as const, reason: 'personal' },
    tags: { items: ['ops', 'sales'], reason: 'tags' },
    properties: { items: [{ key: 'Customer', value: 'Acme' }], reason: 'named' },
    description: { value: 'The detail.', reason: 'moved' },
  };
  const plain = makeNote({ dueDate: null, priority: 'MITTEL', assignee: null });

  it('lists the title first, then every proposed item in order, crossed-out ones with on: false', () => {
    const base = makeSuggestionMark();
    const mark = makeSuggestionMark({
      suggestion: { ...base.suggestion!, fields },
      fields: [
        'dueDate',
        'title',
        'description',
        'subtasks',
        'links',
        'horizon',
        'tags',
        'properties',
      ],
      subtasks: [1],
      links: [2],
      tags: [0],
      properties: [0],
    });
    const rows = proposalRows(plain, mark);
    expect(rows.map((r) => [r.kind, r.field, r.index ?? null, r.on])).toEqual([
      ['title', 'title', null, true],
      ['text', 'description', null, true],
      ['date', 'dueDate', null, true],
      ['horizon', 'horizon', null, true],
      ['priority', 'priority', null, false],
      ['private', 'visibility', null, false],
      ['property', 'properties', 0, true],
      ['tag', 'tags', 0, true],
      ['tag', 'tags', 1, false],
      ['link', 'links', 2, true],
      ['step', 'subtasks', 0, false],
      ['step', 'subtasks', 1, true],
    ]);
    expect(rows[0]).toMatchObject({ value: 'Smart note' });
    expect(rows.find((r) => r.kind === 'tag' && r.index === 1)).toMatchObject({
      value: 'sales',
      reason: 'tags',
    });
  });

  it("shows what the person typed as fixed rows, with the note's own values", () => {
    const base = makeSuggestionMark();
    const mark = makeSuggestionMark({
      suggestion: {
        ...base.suggestion!,
        typed: ['dueDate', 'priority'],
        fields: { ...base.suggestion!.fields, dueDate: null, priority: null, assignee: null },
      },
      fields: [],
    });
    const note = makeNote({ dueDate: '2026-10-20', priority: 'HOCH', assignee: null });
    expect(proposalRows(note, mark)).toEqual([
      expect.objectContaining({ kind: 'date', field: 'dueDate', iso: '2026-10-20', fixed: true }),
      expect.objectContaining({ kind: 'priority', field: 'priority', value: 'HOCH', fixed: true }),
    ]);
  });

  it('shows a record from before smarter capture as one property row', () => {
    const base = makeSuggestionMark();
    const mark = makeSuggestionMark({
      suggestion: {
        ...base.suggestion!,
        fields: {
          ...base.suggestion!.fields,
          dueDate: null,
          priority: null,
          assignee: null,
          reference: { key: 'Customer', value: 'Acme', reason: 'named' },
        },
      },
      fields: ['reference'],
    });
    expect(proposalRows(plain, mark)).toEqual([
      expect.objectContaining({ kind: 'property', field: 'reference', key: 'Customer', on: true }),
    ]);
  });

  it('lists nothing while the call is still running', () => {
    expect(proposalRows(plain, makeSuggestionMark({ phase: 'asking', suggestion: null }))).toEqual(
      [],
    );
  });
});
