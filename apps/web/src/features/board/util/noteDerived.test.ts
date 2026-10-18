import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeNote } from '@/test/fixtures';
import type { BoardViewState } from '../hooks/useBoardViewState';
import {
  collectFieldKeys,
  collectFieldValues,
  filterNotes,
  initialsOf,
  relatedCounts,
  relatedNotes,
  showsVisibilityFilter,
} from './noteDerived';

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
  askOpen: false,
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

  it('folds the property key without a locale: KUNDE finds Kunde, STRASSE not Straße', () => {
    const customer = makeNote({ id: 'c', customFields: { Kunde: 'Müller GmbH' } });
    const street = makeNote({ id: 's', customFields: { Straße: 'Hauptweg 1' } });
    const ids = (fieldKey: string, fieldValue: string | null = null) =>
      filterNotes([customer, street], { ...view, fieldKey, fieldValue }, 'me').map((n) => n.id);
    expect(ids('KUNDE')).toEqual(['c']);
    expect(ids('kunde', 'MÜLLER GMBH')).toEqual(['c']);
    expect(ids('straße')).toEqual(['s']);
    expect(ids('STRASSE')).toEqual([]);
  });
});

describe('collectFieldKeys', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps one spelling per key, the first seen: Kunde, kunde and KUNDE are one', () => {
    const notes = [
      makeNote({ customFields: { Kunde: 'A' } }),
      makeNote({ customFields: { kunde: 'B' } }),
      makeNote({ customFields: { KUNDE: 'C' } }),
    ];
    expect(collectFieldKeys(notes, 'de')).toEqual(['Kunde']);
  });

  it('keeps Straße and STRASSE apart', () => {
    const notes = [
      makeNote({ customFields: { Straße: 'A' } }),
      makeNote({ customFields: { STRASSE: 'B' } }),
    ];
    const keys = collectFieldKeys(notes, 'en');
    expect(keys).toHaveLength(2);
    expect(keys).toEqual(expect.arrayContaining(['Straße', 'STRASSE']));
  });

  it.each(['de', 'en'] as const)('sorts for a reader of %s: Ärger before Zebra', (language) => {
    // A code-point sort would put Zebra first (Z is U+005A, Ä is U+00C4).
    const notes = [
      makeNote({ customFields: { Zebra: '1' } }),
      makeNote({ customFields: { Ärger: '2' } }),
    ];
    expect(collectFieldKeys(notes, language)).toEqual(['Ärger', 'Zebra']);
  });

  it("compares in the reader's language, not a fixed one", () => {
    const compare = vi.spyOn(String.prototype, 'localeCompare');
    const notes = [
      makeNote({ customFields: { Zebra: '1' } }),
      makeNote({ customFields: { Ärger: '2' } }),
    ];
    collectFieldKeys(notes, 'en');
    expect(compare).toHaveBeenCalled();
    expect(compare.mock.calls.every(([, locale]) => locale === 'en')).toBe(true);
  });
});

describe('collectFieldValues', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const notes = [
    makeNote({ customFields: { Kunde: 'Zebra GmbH' } }),
    makeNote({ customFields: { KUNDE: 'Ärger AG' } }),
    makeNote({ customFields: { STRASSE: 'Hauptweg 1' } }),
  ];

  it.each(['de', 'en'] as const)(
    'reads every spelling of the key and sorts for a reader of %s',
    (language) => {
      expect(collectFieldValues(notes, 'kunde', language)).toEqual(['Ärger AG', 'Zebra GmbH']);
    },
  );

  it('does not read STRASSE as Straße', () => {
    expect(collectFieldValues(notes, 'Straße', 'de')).toEqual([]);
  });

  it("compares in the reader's language, not a fixed one", () => {
    const compare = vi.spyOn(String.prototype, 'localeCompare');
    collectFieldValues(notes, 'Kunde', 'en');
    expect(compare).toHaveBeenCalled();
    expect(compare.mock.calls.every(([, locale]) => locale === 'en')).toBe(true);
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

describe('relatedNotes', () => {
  it('lists own links in order, then backlinks, drops an id it cannot resolve, and names a two-way pair once', () => {
    const a = makeNote({ id: 'a', links: ['c', 'gone', 'b'] });
    const b = makeNote({ id: 'b', links: ['a'] });
    const c = makeNote({ id: 'c', links: [] });
    const d = makeNote({ id: 'd', links: ['a'] });
    const notes = [a, b, c, d];
    expect(relatedNotes(a, notes).map((r) => [r.note.id, r.direction])).toEqual([
      ['c', 'out'],
      ['b', 'out'],
      ['d', 'in'],
    ]);
    expect(relatedNotes(c, notes).map((r) => [r.note.id, r.direction])).toEqual([['a', 'in']]);
  });
});

describe('relatedCounts', () => {
  it('counts what the panel lists: no dangling id, backlinks included, a two-way pair once', () => {
    // A links B and C; C was deleted (or made private), so its id dangles on A.
    const a = makeNote({ id: 'a', links: ['b', 'c'] });
    const b = makeNote({ id: 'b', links: [] });
    // D and E link each other; F links nothing and nobody links F.
    const d = makeNote({ id: 'd', links: ['e'] });
    const e = makeNote({ id: 'e', links: ['d'] });
    const f = makeNote({ id: 'f', links: [] });
    const notes = [a, b, d, e, f];
    const counts = relatedCounts(notes);
    expect(counts.get('a')).toBe(1);
    expect(counts.get('b')).toBe(1);
    expect(counts.get('d')).toBe(1);
    expect(counts.get('e')).toBe(1);
    expect(counts.has('f')).toBe(false);
    for (const note of notes) {
      expect(counts.get(note.id) ?? 0).toBe(relatedNotes(note, notes).length);
    }
  });
});
