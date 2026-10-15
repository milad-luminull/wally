import { describe, expect, it } from 'vitest';
import { CHARS_PER_TOKEN, estimateTokens } from './estimate.js';

describe('estimateTokens', () => {
  it('counts serialized characters at the conservative ratio, rounding up', () => {
    const parts = ['abc', { k: 'v' }];
    const chars = JSON.stringify(parts).length;
    expect(estimateTokens(parts)).toBe(Math.ceil(chars / CHARS_PER_TOKEN));
  });
  it('never returns zero for a non-empty input', () => {
    expect(estimateTokens(['x'])).toBeGreaterThan(0);
  });
});
