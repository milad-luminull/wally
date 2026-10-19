import { describe, expect, it } from 'vitest';
import type { ModelSuggestion } from './model/index.js';
import {
  acceptCapture,
  buildCaptureCall,
  captureCandidates,
  type CaptureBoardNote,
  type CaptureContext,
  type CaptureNote,
} from './captureProposal.js';

const me = { id: 'u-me', email: 'me@example.com', displayName: 'Me' };

function note(overrides: Partial<CaptureNote> = {}): CaptureNote {
  return {
    id: 'n-1',
    title: 'Send the offer to Acme',
    description: '',
    dueDate: null,
    priority: 'MITTEL',
    assignee: null,
    visibility: 'SHARED',
    horizon: 'HEUTE',
    tags: [],
    customFields: {},
    subtaskSummary: { total: 0, done: 0 },
    links: [],
    createdBy: me,
    ...overrides,
  };
}

function boardNote(overrides: Partial<CaptureBoardNote> & { id: string }): CaptureBoardNote {
  return {
    title: 'Another note',
    status: 'OPEN',
    createdAt: '2026-10-10T10:00:00.000Z',
    visibility: 'SHARED',
    horizon: 'HEUTE',
    priority: 'MITTEL',
    tags: [],
    customFields: {},
    createdBy: me,
    ...overrides,
  };
}

const ctx: CaptureContext = {
  actorId: me.id,
  today: '2026-10-19',
  timeZone: 'Europe/Berlin',
  language: 'en',
  locked: [],
  members: [
    { id: me.id, name: 'Me' },
    { id: 'u-anna', name: 'Anna' },
  ],
  canChangeVisibility: true,
};

const none: ModelSuggestion = {
  dueDate: null,
  priority: null,
  assignee: null,
  title: null,
  subtasks: null,
  links: null,
  horizon: null,
  visibility: null,
  tags: null,
  properties: null,
  description: null,
};

describe('buildCaptureCall', () => {
  it('returns null when every field is filled or locked', () => {
    const full = note({
      dueDate: '2026-10-20',
      priority: 'HOCH',
      assignee: me,
      customFields: { Customer: 'Acme' },
      subtaskSummary: { total: 1, done: 0 },
      links: ['n-2'],
      horizon: 'DIESE_WOCHE',
      tags: ['sales'],
      description: 'Already written.',
    });
    expect(buildCaptureCall(full, [], { ...ctx, locked: ['title'] })).toBeNull();
  });

  it('drops links when no other open note exists', () => {
    const call = buildCaptureCall(note(), [boardNote({ id: 'n-2', status: 'DONE' })], ctx);
    expect(call).not.toBeNull();
    expect(call!.open).not.toContain('links');
    expect(call!.others.size).toBe(0);
  });
});

describe('acceptCapture', () => {
  const call = () =>
    buildCaptureCall(note(), [boardNote({ id: 'n-2', title: 'Acme renewal' })], ctx)!;

  it('drops low confidence, unknown members, past dates and links to notes not shown', () => {
    const fields = acceptCapture(
      {
        ...none,
        dueDate: { value: '2026-10-18', confidence: 0.9, reason: 'yesterday' },
        priority: { value: 'HOCH', confidence: 0.4, reason: 'maybe' },
        assignee: { memberId: 'u-stranger', confidence: 0.9, reason: 'named' },
        links: {
          items: [{ noteId: 'n-unknown', reason: 'same customer' }],
          confidence: 0.9,
          reason: 'related',
        },
      },
      call(),
      note(),
      ctx,
    );
    expect(fields).toBeNull();
  });

  it('keeps a confident date, a member and a link to a shown note', () => {
    const fields = acceptCapture(
      {
        ...none,
        dueDate: { value: '2026-10-23', confidence: 0.9, reason: '"by Friday"' },
        assignee: { memberId: 'u-anna', confidence: 0.8, reason: '"ask Anna"' },
        links: {
          items: [{ noteId: 'n-2', reason: 'Acme in both' }],
          confidence: 0.8,
          reason: 'related',
        },
      },
      call(),
      note(),
      ctx,
    );
    expect(fields?.dueDate?.value).toBe('2026-10-23');
    expect(fields?.assignee?.value).toBe('u-anna');
    expect(fields?.links?.items.map((i) => i.noteId)).toEqual(['n-2']);
  });
});

describe('the board context a capture sends', () => {
  const board = [
    boardNote({
      id: 'b-1',
      title: 'Acme renewal',
      tags: ['sales'],
      customFields: { Customer: 'Acme' },
      createdAt: '2026-10-11T10:00:00.000Z',
    }),
    boardNote({
      id: 'b-2',
      title: 'Northwind offer',
      tags: ['Sales'],
      customFields: { customer: 'Northwind' },
      createdAt: '2026-10-12T10:00:00.000Z',
    }),
    boardNote({
      id: 'b-3',
      title: 'Globex call',
      customFields: { Customer: 'Globex' },
      createdAt: '2026-10-13T10:00:00.000Z',
    }),
    boardNote({
      id: 'b-4',
      title: 'Initech call',
      customFields: { Customer: 'Initech' },
      createdAt: '2026-10-14T10:00:00.000Z',
    }),
    boardNote({
      id: 'b-5',
      title: 'Physio follow-up',
      visibility: 'PRIVATE',
      tags: ['health'],
      customFields: { Clinic: 'Riverside' },
      createdAt: '2026-10-15T10:00:00.000Z',
    }),
    boardNote({
      id: 'b-6',
      title: "Anna's note",
      createdBy: { id: 'u-anna', email: 'anna@example.com', displayName: 'Anna' },
      createdAt: '2026-10-16T10:00:00.000Z',
    }),
  ];

  it("a shared note's context leaves out every private note", () => {
    const shared = buildCaptureCall(note(), board, ctx)!.prompt;
    expect(shared).not.toContain('health');
    expect(shared).not.toContain('Clinic');
    expect(shared).not.toContain('Riverside');
    expect(shared.split('Recent notes by this person:')[1]).not.toContain('Physio');
    const own = buildCaptureCall(note({ visibility: 'PRIVATE' }), board, ctx)!.prompt;
    expect(own).toContain('health');
    expect(own).toContain('Clinic\n  - Riverside');
  });

  it("recent rows are the caller's own notes, newest first, never the note itself", () => {
    const prompt = buildCaptureCall(note({ id: 'b-4' }), board, ctx)!.prompt;
    const recent = prompt.split('Recent notes by this person:\n')[1]!.split('\nOther notes')[0]!;
    const titles = recent.split('\n').map((line) => line.slice(2).split(' | ')[0]);
    expect(titles).toEqual(['Globex call', 'Northwind offer', 'Acme renewal']);
  });

  it('example values are the newest distinct ones per key, at most three, and tags fold once', () => {
    const prompt = buildCaptureCall(note(), board, ctx)!.prompt;
    expect(prompt).toContain('Customer\n  - Initech\n  - Globex\n  - Northwind\n');
    expect(prompt).toContain('Tags on this board:\nsales\n');
    expect(prompt.match(/^sales$/gim)).toHaveLength(1);
  });
});

describe('which new fields a capture may propose', () => {
  const opened = (n: CaptureNote, c: Partial<CaptureContext> = {}) =>
    captureCandidates(n, { ...ctx, ...c });

  it('opens each new field only while the note holds nothing there', () => {
    expect(opened(note())).toEqual(
      expect.arrayContaining(['horizon', 'visibility', 'tags', 'properties', 'description']),
    );
    expect(opened(note())).not.toContain('reference');
    const filled = note({
      horizon: 'DIESE_WOCHE',
      visibility: 'PRIVATE',
      tags: ['sales'],
      customFields: { Customer: 'Acme' },
      description: 'Already written.',
    });
    for (const key of ['horizon', 'visibility', 'tags', 'properties', 'description'] as const)
      expect(opened(filled), key).not.toContain(key);
    expect(
      opened(note(), { locked: ['horizon', 'tags', 'properties', 'description'] }),
    ).not.toEqual(expect.arrayContaining(['horizon']));
  });

  it('never opens visibility for a viewer, on a board with no other member, on a note with an assignee, or when visibility or assignee is locked', () => {
    expect(opened(note(), { canChangeVisibility: false })).not.toContain('visibility');
    expect(opened(note(), { members: [{ id: me.id, name: 'Me' }] })).not.toContain('visibility');
    expect(opened(note({ assignee: me }))).not.toContain('visibility');
    expect(opened(note(), { locked: ['visibility'] })).not.toContain('visibility');
    expect(opened(note(), { locked: ['assignee'] })).not.toContain('visibility');
    const someoneElses = note({
      createdBy: { id: 'u-anna', email: 'a@example.com', displayName: 'Anna' },
    });
    expect(opened(someoneElses)).not.toContain('visibility');
  });
});

describe('the rules applied to an answer', () => {
  const board = [
    boardNote({
      id: 'b-1',
      tags: ['Sales'],
      customFields: { Customer: 'Acme', 'Contract number': '1' },
    }),
  ];
  const accept = (
    fields: Partial<ModelSuggestion>,
    n: CaptureNote = note(),
    c: CaptureContext = ctx,
  ) => acceptCapture({ ...none, ...fields }, buildCaptureCall(n, board, c)!, n, c);
  const sure = { confidence: 0.9, reason: 'r' };

  it('PRIVATE drops the assignee proposal', () => {
    const fields = accept({
      visibility: { value: 'PRIVATE', ...sure },
      assignee: { memberId: 'u-anna', ...sure },
    });
    expect(fields?.visibility?.value).toBe('PRIVATE');
    expect(fields?.assignee).toBeNull();
  });

  it('a horizon that disagrees with the proposed date is dropped', () => {
    // Today is Monday 2026-10-19; the week ends on Sunday the 25th.
    const today = accept({
      dueDate: { value: '2026-10-19', ...sure },
      horizon: { value: 'DIESE_WOCHE', ...sure },
    });
    expect(today?.horizon).toBeNull();
    const later = accept({
      dueDate: { value: '2026-10-29', ...sure },
      horizon: { value: 'DIESE_WOCHE', ...sure },
    });
    expect(later?.horizon).toBeNull();
    const agrees = accept({
      dueDate: { value: '2026-10-29', ...sure },
      horizon: { value: 'SPAETER', ...sure },
    });
    expect(agrees?.horizon?.value).toBe('SPAETER');
    // A date the person typed counts the same way.
    const typed = accept(
      { horizon: { value: 'SPAETER', ...sure } },
      note({ dueDate: '2026-10-21' }),
    );
    expect(typed).toBeNull();
  });

  it('a description without a title is dropped', () => {
    expect(accept({ description: { value: 'Detail.', ...sure } })).toBeNull();
    const both = accept({
      title: { value: 'Send the offer', ...sure },
      description: { value: 'Detail.', ...sure },
    });
    expect(both?.description?.value).toBe('Detail.');
  });

  it("properties fold to the board's keys and drop a bad key or value per item", () => {
    const fields = accept({
      properties: {
        items: [
          { key: 'customer', value: 'Acme' },
          { key: 'Cust.omer', value: 'bad key' },
          { key: 'CONTRACT NUMBER', value: '4711' },
        ],
        ...sure,
      },
    });
    expect(fields?.properties?.items).toEqual([
      { key: 'Customer', value: 'Acme' },
      { key: 'Contract number', value: '4711' },
    ]);
    expect(fields?.reference).toBeNull();
  });

  it("tags reuse the board's spelling by fold", () => {
    const fields = accept({ tags: { items: ['sales', 'travel'], ...sure } });
    expect(fields?.tags?.items).toEqual(['Sales', 'travel']);
  });

  it('a property or tag item past three is dropped', () => {
    const fields = accept({
      tags: { items: ['a', 'b', 'c', 'd'], ...sure },
      properties: {
        items: [
          { key: 'A', value: '1' },
          { key: 'B', value: '2' },
          { key: 'C', value: '3' },
          { key: 'D', value: '4' },
        ],
        ...sure,
      },
    });
    expect(fields?.tags?.items).toHaveLength(3);
    expect(fields?.properties?.items).toHaveLength(3);
  });
});
