import { describe, expect, it } from 'vitest';
import { acceptModelMoves, mayMoveFor, tidyCandidates, type TidyNote } from './tidyPlan.js';

const me = { id: 'me', email: 'me@example.com', displayName: 'Me' };
const note = (over: Partial<TidyNote> & { id: string }): TidyNote => ({
  title: 'A note',
  description: '',
  status: 'OPEN',
  horizon: 'TODAY',
  dueDate: null,
  revision: 2,
  visibility: 'SHARED',
  createdBy: me,
  createdAt: '2026-10-17T10:00:00.000Z',
  ...over,
});
const all = () => true;
// 2026-10-17 is a Saturday.
const today = '2026-10-17';

describe('tidyCandidates', () => {
  it('moves dated notes by the date rule, with the note revision and no reason', () => {
    const { dated } = tidyCandidates(
      [
        note({ id: 'late', horizon: 'THIS_WEEK', dueDate: '2026-10-19' }),
        note({ id: 'right', horizon: 'LATER', dueDate: '2026-10-19' }),
        note({ id: 'overdue', horizon: 'LATER', dueDate: '2026-10-01', revision: 7 }),
      ],
      today,
      all,
    );
    expect(dated).toEqual([
      {
        noteId: 'late',
        baseRevision: 2,
        from: 'THIS_WEEK',
        to: 'LATER',
        reason: null,
        source: 'date',
      },
      {
        noteId: 'overdue',
        baseRevision: 7,
        from: 'LATER',
        to: 'TODAY',
        reason: null,
        source: 'date',
      },
    ]);
  });

  it('drops the five oldest of thirty-five undated notes', () => {
    const notes = Array.from({ length: 35 }, (_, i) =>
      note({ id: `u${i}`, createdAt: new Date(Date.UTC(2026, 9, 1, i)).toISOString() }),
    );
    const { undated } = tidyCandidates([...notes].reverse(), today, all);
    const ids = undated.map((n) => n.id);
    expect(ids).toHaveLength(30);
    for (const oldest of ['u0', 'u1', 'u2', 'u3', 'u4']) expect(ids).not.toContain(oldest);
    expect(ids[0]).toBe('u34');
    expect(ids.at(-1)).toBe('u5');
  });

  it('hands the undated notes of Today to the model, newest first and at most thirty', () => {
    const notes = Array.from({ length: 35 }, (_, i) =>
      note({
        id: `u${i}`,
        createdAt: `2026-10-${String(1 + (i % 17)).padStart(2, '0')}T0${i % 10}:00:00.000Z`,
      }),
    );
    const { undated } = tidyCandidates(
      [
        ...notes,
        note({ id: 'placed', horizon: 'LATER' }),
        note({ id: 'dated', dueDate: '2026-10-17' }),
      ],
      today,
      all,
    );
    expect(undated).toHaveLength(30);
    expect(undated.map((n) => n.id)).not.toContain('placed');
    expect(undated.map((n) => n.id)).not.toContain('dated');
    for (let i = 1; i < undated.length; i++)
      expect(undated[i - 1]!.createdAt >= undated[i]!.createdAt).toBe(true);
  });

  it('leaves out done notes and notes the person may not move', () => {
    const { dated, undated } = tidyCandidates(
      [
        note({ id: 'done', status: 'DONE', dueDate: '2026-10-01', horizon: 'LATER' }),
        note({
          id: 'theirs',
          dueDate: '2026-10-01',
          horizon: 'LATER',
          createdBy: { ...me, id: 'other' },
        }),
        note({ id: 'mine' }),
      ],
      today,
      (n) => n.createdBy?.id === 'me',
    );
    expect(dated).toEqual([]);
    expect(undated.map((n) => n.id)).toEqual(['mine']);
  });
});

describe('mayMoveFor', () => {
  it('lets an owner or editor move any note, a viewer only their own private ones', () => {
    const shared = note({ id: 's' });
    const ownPrivate = note({ id: 'p', visibility: 'PRIVATE' });
    const othersPrivate = note({
      id: 'o',
      visibility: 'PRIVATE',
      createdBy: { ...me, id: 'other' },
    });
    expect(mayMoveFor('EDIT', 'me')(shared)).toBe(true);
    expect(mayMoveFor('OWNER', 'me')(othersPrivate)).toBe(true);
    expect(mayMoveFor('VIEW', 'me')(shared)).toBe(false);
    expect(mayMoveFor('VIEW', 'me')(ownPrivate)).toBe(true);
    expect(mayMoveFor('VIEW', 'me')(othersPrivate)).toBe(false);
  });
});

describe('acceptModelMoves', () => {
  const undated = [note({ id: 'a', revision: 4 }), note({ id: 'b' })];
  it('keeps a confident move of a listed note, once, with its words', () => {
    expect(
      acceptModelMoves(
        [
          { noteId: 'a', horizon: 'LATER', confidence: 0.9, reason: 'next month' },
          { noteId: 'a', horizon: 'THIS_WEEK', confidence: 0.8, reason: 'twice' },
          { noteId: 'b', horizon: 'LATER', confidence: 0.3, reason: 'maybe' },
          { noteId: 'zzz', horizon: 'LATER', confidence: 0.9, reason: 'not listed' },
        ],
        undated,
        today,
      ),
    ).toEqual([
      {
        noteId: 'a',
        baseRevision: 4,
        from: 'TODAY',
        to: 'LATER',
        reason: 'next month',
        source: 'words',
      },
    ]);
  });

  it('on a Sunday, sends a move to This week to Later: the week ends today', () => {
    const sunday = '2026-10-18';
    expect(
      acceptModelMoves(
        [{ noteId: 'a', horizon: 'THIS_WEEK', confidence: 0.9, reason: 'by Friday' }],
        undated,
        sunday,
      ),
    ).toEqual([
      {
        noteId: 'a',
        baseRevision: 4,
        from: 'TODAY',
        to: 'LATER',
        reason: 'by Friday',
        source: 'words',
      },
    ]);
    expect(
      acceptModelMoves(
        [{ noteId: 'a', horizon: 'THIS_WEEK', confidence: 0.9, reason: 'by Friday' }],
        undated,
        today,
      )[0]!.to,
    ).toBe('THIS_WEEK');
  });
});
