import { describe, expect, it } from 'vitest';
import { anchorShows } from './placement';

const free = { kind: 'free', x: 10, y: 20 } as const;
const horizon = {
  kind: 'zone',
  axis: 'horizon',
  key: 'TODAY',
  at: { freeX: 0, freeY: 0 },
} as const;

describe('anchorShows', () => {
  it('draws a box anchored on the free wall only on the free wall', () => {
    expect(anchorShows('wall', 'free', free)).toBe(true);
    expect(anchorShows('wall', 'horizon', free)).toBe(false);
  });

  it('draws a box anchored in a zone only on that axis', () => {
    expect(anchorShows('wall', 'horizon', horizon)).toBe(true);
    expect(anchorShows('wall', 'priority', horizon)).toBe(false);
  });

  it('draws no anchored box in the list', () => {
    expect(anchorShows('list', 'horizon', horizon)).toBe(false);
  });
});
