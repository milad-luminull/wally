import { describe, expect, it } from 'vitest';
import { customFieldsSchema, findFieldKey, foldFieldKey } from '@wally/shared';
import { matchesFieldFilter } from './queries.js';

/**
 * The property-key fold is data integrity, so it is pinned here once for the shared schema and
 * once for the `?field=` filter: the same answer for every caller, whatever their language.
 * `packages/shared` has no test runner, which is why the shared half lives here.
 */
describe('the property-key fold', () => {
  it('treats Customer, customer and CUSTOMER as one property', () => {
    expect(customFieldsSchema.safeParse({ Customer: 'A', customer: 'B' }).success).toBe(false);
    expect(customFieldsSchema.safeParse({ Customer: 'A', CUSTOMER: 'B' }).success).toBe(false);
    expect(customFieldsSchema.safeParse({ customer: 'A', CUSTOMER: 'B' }).success).toBe(false);
    expect(findFieldKey({ Customer: 'A' }, 'customer')).toBe('Customer');
    expect(findFieldKey({ Customer: 'A' }, ' CUSTOMER ')).toBe('Customer');
    expect(foldFieldKey('Customer')).toBe(foldFieldKey('CUSTOMER'));
  });

  it('keeps Straße and STRASSE as two properties: a case fold, not a full fold', () => {
    expect(customFieldsSchema.safeParse({ Straße: 'A', STRASSE: 'B' }).success).toBe(true);
    expect(findFieldKey({ Straße: 'A' }, 'STRASSE')).toBeUndefined();
    expect(findFieldKey({ Straße: 'A' }, 'STRASSE'.toLowerCase())).toBeUndefined();
    expect(findFieldKey({ Straße: 'A' }, 'straße')).toBe('Straße');
  });

  it('is locale-neutral: no locale changes which keys collide', () => {
    // A Turkish fold would turn I into a dotless ı; the stored rule must not.
    expect(foldFieldKey('TITLE')).toBe('title');
    expect(foldFieldKey('  Contract   no ')).toBe('contract no');
  });
});

describe('matchesFieldFilter', () => {
  const fields = { Customer: 'Müller GmbH', Straße: 'Hauptweg 1' };

  it('matches a key in any case, alone or with its value', () => {
    expect(matchesFieldFilter(fields, 'customer')).toBe(true);
    expect(matchesFieldFilter(fields, 'CUSTOMER')).toBe(true);
    expect(matchesFieldFilter(fields, 'Customer:müller gmbh')).toBe(true);
    expect(matchesFieldFilter(fields, 'CUSTOMER:MÜLLER GMBH')).toBe(true);
    expect(matchesFieldFilter(fields, 'Customer:Steiner AG')).toBe(false);
  });

  it('does not match STRASSE to Straße', () => {
    expect(matchesFieldFilter(fields, 'straße')).toBe(true);
    expect(matchesFieldFilter(fields, 'STRASSE')).toBe(false);
  });

  it('splits on the first colon only, so a value may contain one', () => {
    expect(matchesFieldFilter({ Time: '10:30' }, 'time:10:30')).toBe(true);
  });

  it('matches nothing on a note without properties', () => {
    expect(matchesFieldFilter({}, 'Customer')).toBe(false);
  });
});
