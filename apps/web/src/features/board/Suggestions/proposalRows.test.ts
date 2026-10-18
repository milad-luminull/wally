import { describe, expect, it } from 'vitest';
import { makeSuggestionMark } from '@/test/fixtures';
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

  it('lists every proposed item in order, crossed-out ones with on: false', () => {
    const base = makeSuggestionMark();
    const mark = makeSuggestionMark({
      suggestion: { ...base.suggestion!, fields },
      fields: ['dueDate', 'subtasks', 'links', 'horizon', 'tags', 'properties'],
      subtasks: [1],
      links: [2],
      tags: [0],
      properties: [0],
    });
    const rows = proposalRows(mark);
    expect(rows.map((r) => [r.kind, r.field, r.index ?? null, r.on])).toEqual([
      ['date', 'dueDate', null, true],
      ['horizon', 'horizon', null, true],
      ['priority', 'priority', null, false],
      ['private', 'visibility', null, false],
      ['property', 'properties', 0, true],
      ['tag', 'tags', 0, true],
      ['tag', 'tags', 1, false],
      ['step', 'subtasks', 0, false],
      ['step', 'subtasks', 1, true],
      ['link', 'links', 2, true],
    ]);
    expect(rows.find((r) => r.kind === 'tag' && r.index === 1)).toMatchObject({
      value: 'sales',
      reason: 'tags',
    });
    // The title and its description are on the title line, not in the list.
    expect(rows.some((r) => r.field === 'title' || r.field === 'description')).toBe(false);
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
    expect(proposalRows(mark)).toEqual([
      expect.objectContaining({ kind: 'property', field: 'reference', key: 'Customer', on: true }),
    ]);
  });

  it('lists nothing while the call is still running', () => {
    expect(proposalRows(makeSuggestionMark({ phase: 'asking', suggestion: null }))).toEqual([]);
  });
});
