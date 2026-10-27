import { describe, expect, it } from 'vitest';
import { boardEntryWithReturn, readReturnPath } from './returnPath';

describe('readReturnPath', () => {
  it('accepts share links and board paths', () => {
    expect(readReturnPath({ from: '/share/tok' })).toBe('/share/tok');
    expect(readReturnPath({ from: '/boards/abc?view=list' })).toBe('/boards/abc?view=list');
  });

  it('ignores anything that is not one of those', () => {
    expect(readReturnPath({ from: '/settings/account' })).toBeNull();
    for (const from of [
      '//evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/login',
      '/',
      '/boards',
      '/boards/',
      '',
      undefined,
      42,
    ])
      expect(readReturnPath({ from })).toBeNull();
    expect(readReturnPath(null)).toBeNull();
    expect(readReturnPath(undefined)).toBeNull();
  });
});

describe('boardEntryWithReturn', () => {
  it('sends sign-in to the protected board entry, carrying the return path for it to check', () => {
    expect(boardEntryWithReturn('/boards/abc')).toEqual({
      pathname: '/app',
      state: { to: '/boards/abc' },
    });
    expect(boardEntryWithReturn(null)).toEqual({ pathname: '/app', state: { to: null } });
  });
});
