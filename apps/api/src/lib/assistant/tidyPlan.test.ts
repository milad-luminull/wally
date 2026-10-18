import { describe, expect, it } from 'vitest';
import { acceptModelMoves, mayMoveFor, tidyCandidates, type TidyNote } from './tidyPlan.js';

const me = { id: 'me', email: 'me@example.com', displayName: 'Me' };
const note = (over: Partial<TidyNote> & { id: string }): TidyNote => ({
  title: 'A note',
  description: '',
  status: 'OPEN',
  horizon: 'HEUTE',
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
        note({ id: 'late', horizon: 'DIESE_WOCHE', dueDate: '2026-10-19' }),
        note({ id: 'right', horizon: 'SPAETER', dueDate: '2026-10-19' }),
        note({ id: 'overdue', horizon: 'SPAETER', dueDate: '2026-10-01', revision: 7 }),
      ],
      today,
      all,
    );
    expect(dated).toEqual([
      {
        noteId: 'late',
        baseRevision: 2,
        from: 'DIESE_WOCHE',
        to: 'SPAETER',
        reason: null,
        source: 'date',
      },
      {
        noteId: 'overdue',
        baseRevision: 7,
        from: 'SPAETER',
        to: 'HEUTE',
        reason: null,
        source: 'date',
      },
    ]);
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
        note({ id: 'placed', horizon: 'SPAETER' }),
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
        note({ id: 'done', status: 'DONE', dueDate: '2026-10-01', horizon: 'SPAETER' }),
        note({
          id: 'theirs',
          dueDate: '2026-10-01',
          horizon: 'SPAETER',
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
          { noteId: 'a', horizon: 'SPAETER', confidence: 0.9, reason: 'next month' },
          { noteId: 'a', horizon: 'DIESE_WOCHE', confidence: 0.8, reason: 'twice' },
          { noteId: 'b', horizon: 'SPAETER', confidence: 0.3, reason: 'maybe' },
          { noteId: 'zzz', horizon: 'SPAETER', confidence: 0.9, reason: 'not listed' },
        ],
        undated,
      ),
    ).toEqual([
      {
        noteId: 'a',
        baseRevision: 4,
        from: 'HEUTE',
        to: 'SPAETER',
        reason: 'next month',
        source: 'words',
      },
    ]);
  });
});
