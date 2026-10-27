import { describe, expect, it } from 'vitest';
import { tidyOnWall } from './tidyOnWall';

describe('tidyOnWall', () => {
  it('is on for the horizon wall of a board whose assistant is on', () => {
    expect(tidyOnWall(true, 'wall', 'horizon')).toBe(true);
  });

  it('is off with the assistant off, even on the horizon wall (no bar, no strip)', () => {
    expect(tidyOnWall(false, 'wall', 'horizon')).toBe(false);
  });

  it('is off on the priority wall, the free canvas and the list', () => {
    expect(tidyOnWall(true, 'wall', 'priority')).toBe(false);
    expect(tidyOnWall(true, 'wall', 'free')).toBe(false);
    expect(tidyOnWall(true, 'list', 'horizon')).toBe(false);
  });
});
