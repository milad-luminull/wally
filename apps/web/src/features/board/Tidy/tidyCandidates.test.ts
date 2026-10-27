import { describe, expect, it } from 'vitest';
import { makeNote } from '@/test/fixtures';
import { candidateSignature, tidyCandidateIds } from './tidyCandidates';

// 2026-10-17 is a Saturday.
const today = '2026-10-17';
const all = () => true;

describe('tidyCandidateIds', () => {
  it('counts dated notes in the wrong zone and undated notes in Today, open and movable only', () => {
    const notes = [
      makeNote({ id: 'late', horizon: 'THIS_WEEK', dueDate: '2026-10-19' }),
      makeNote({ id: 'right', horizon: 'LATER', dueDate: '2026-10-19' }),
      makeNote({ id: 'jotted', horizon: 'TODAY', dueDate: null }),
      makeNote({ id: 'placed', horizon: 'LATER', dueDate: null }),
      makeNote({ id: 'done', horizon: 'LATER', dueDate: '2026-10-01', status: 'DONE' }),
      makeNote({ id: 'theirs', horizon: 'LATER', dueDate: '2026-10-01' }),
    ];
    expect(tidyCandidateIds(notes, today, (n) => n.id !== 'theirs', new Set())).toEqual([
      'late',
      'jotted',
    ]);
  });

  it('leaves out a note with a pending Wallybot change', () => {
    const notes = [makeNote({ id: 'jotted', horizon: 'TODAY', dueDate: null })];
    expect(tidyCandidateIds(notes, today, all, new Set(['jotted']))).toEqual([]);
  });
});

describe('candidateSignature', () => {
  it('changes with the set and with a revision, not with order', () => {
    const a = makeNote({ id: 'a', revision: 1 });
    const b = makeNote({ id: 'b', revision: 2 });
    expect(candidateSignature([a, b], ['a', 'b'])).toBe(candidateSignature([b, a], ['b', 'a']));
    expect(candidateSignature([a, b], ['a'])).not.toBe(candidateSignature([a, b], ['a', 'b']));
    expect(candidateSignature([{ ...a, revision: 2 }, b], ['a', 'b'])).not.toBe(
      candidateSignature([a, b], ['a', 'b']),
    );
  });
});
