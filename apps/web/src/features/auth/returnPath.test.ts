import { describe, expect, it } from 'vitest';
import { landingWithReturn, readReturnPath } from './returnPath';

describe('readReturnPath', () => {
  it('accepts share links and board paths', () => {
    expect(readReturnPath({ from: '/share/tok' })).toBe('/share/tok');
    expect(readReturnPath({ from: '/boards/abc?view=list' })).toBe('/boards/abc?view=list');
  });

  it('ignores anything that is not one of those', () => {
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

describe('landingWithReturn', () => {
  it('always sends sign-in to the landing, carrying the return path for it to check', () => {
    expect(landingWithReturn('/boards/abc')).toEqual({
      pathname: '/',
      state: { to: '/boards/abc' },
    });
    expect(landingWithReturn(null)).toEqual({ pathname: '/', state: { to: null } });
  });
});
