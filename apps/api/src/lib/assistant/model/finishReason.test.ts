import { describe, expect, it } from 'vitest';
import { toFinishReason } from './finishReason.js';

describe('toFinishReason', () => {
  it('keeps the reasons Wally shares with the library', () => {
    for (const reason of [
      'stop',
      'length',
      'content-filter',
      'tool-calls',
      'error',
      'other',
    ] as const)
      expect(toFinishReason(reason)).toBe(reason);
  });

  it('reports an interrupted reply as cut short', () => {
    expect(toFinishReason('interrupted')).toBe('length');
  });
});
