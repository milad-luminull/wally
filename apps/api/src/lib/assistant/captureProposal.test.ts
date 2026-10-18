import { describe, expect, it } from 'vitest';
import type { ModelSuggestion } from './model/index.js';
import {
  acceptCapture,
  buildCaptureCall,
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
  reference: null,
  subtasks: null,
  links: null,
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
