import { describe, expect, it } from 'vitest';
import { initialsOf } from './noteDerived';

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
