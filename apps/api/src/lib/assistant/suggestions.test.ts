import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectKeys } from './suggestions.js';

const notes = (...fields: Record<string, string>[]) =>
  fields.map((customFields) => ({ customFields }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('collectKeys', () => {
  it('keeps one spelling per key, the first seen: Kunde, kunde and KUNDE are one', () => {
    expect(collectKeys(notes({ Kunde: 'A' }, { kunde: 'B' }, { KUNDE: 'C' }), 'de')).toEqual([
      'Kunde',
    ]);
  });

  it('keeps Straße and STRASSE apart', () => {
    const keys = collectKeys(notes({ Straße: 'A' }, { STRASSE: 'B' }), 'en');
    expect(keys).toHaveLength(2);
    expect(keys).toEqual(expect.arrayContaining(['Straße', 'STRASSE']));
  });

  it.each(['de', 'en'] as const)('sorts for a reader of %s: Ärger before Zebra', (language) => {
    // A code-point sort would put Zebra first (Z is U+005A, Ä is U+00C4).
    expect(collectKeys(notes({ Zebra: '1' }, { Ärger: '2' }), language)).toEqual([
      'Ärger',
      'Zebra',
    ]);
  });

  it("compares in the caller's language, not a fixed one", () => {
    const compare = vi.spyOn(String.prototype, 'localeCompare');
    collectKeys(notes({ Zebra: '1' }, { Ärger: '2' }), 'en');
    expect(compare).toHaveBeenCalled();
    expect(compare.mock.calls.every(([, locale]) => locale === 'en')).toBe(true);
  });
});
