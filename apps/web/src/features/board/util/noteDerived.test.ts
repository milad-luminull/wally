import { describe, expect, it } from 'vitest';
import { makeNote } from '@/test/fixtures';
import type { BoardViewState } from '../hooks/useBoardViewState';
import { filterNotes, initialsOf, showsVisibilityFilter } from './noteDerived';

const view: BoardViewState = {
  view: 'wand',
  axis: 'horizon',
  q: '',
  priority: [],
  mine: false,
  done: true,
  visibility: 'all',
  fieldKey: null,
  fieldValue: null,
  noteId: null,
};

describe('filterNotes', () => {
  it('filters by visibility', () => {
    const shared = makeNote({ id: 'a' });
    const priv = makeNote({ id: 'b', visibility: 'PRIVATE' });
    const ids = (visibility: 'all' | 'private' | 'shared') =>
      filterNotes([shared, priv], { ...view, visibility }, 'me').map((n) => n.id);
    expect(ids('all')).toEqual(['a', 'b']);
    expect(ids('private')).toEqual(['b']);
    expect(ids('shared')).toEqual(['a']);
  });
});

describe('initialsOf', () => {
  it('takes the first letters of the first two words of a name', () => {
    expect(initialsOf('Nora Falk')).toBe('NF');
    expect(initialsOf('Anna Maria Schulz')).toBe('AM');
    expect(initialsOf('Cher')).toBe('C');
  });

  it('reads an email by its local part, split on the usual separators', () => {
    expect(initialsOf('milad.rezazadeh@example.com')).toBe('MR');
    expect(initialsOf('jonas_weber@example.com')).toBe('JW');
    expect(initialsOf('nora-falk@example.com')).toBe('NF');
    expect(initialsOf('admin@example.com')).toBe('A');
  });
});

describe('showsVisibilityFilter', () => {
  it('shows the visibility chips when a filter is on or a private note exists', () => {
    expect(showsVisibilityFilter([makeNote()], 'all')).toBe(false);
    expect(showsVisibilityFilter([makeNote({ visibility: 'PRIVATE' })], 'all')).toBe(true);
    // Review Focus 5: never strand the user behind a filter they cannot see to turn off.
    expect(showsVisibilityFilter([], 'private')).toBe(true);
  });
});
