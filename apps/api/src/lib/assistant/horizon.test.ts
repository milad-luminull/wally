import { describe, expect, it } from 'vitest';
import { endOfWeek, horizonForDueDate } from '@wally/shared';

describe('horizonForDueDate', () => {
  // 2026-10-17 is a Saturday; the week ends on Sunday the 18th.
  const today = '2026-10-17';

  it('ends the week on Sunday, today included', () => {
    expect(endOfWeek('2026-10-17')).toBe('2026-10-18');
    expect(endOfWeek('2026-10-18')).toBe('2026-10-18');
    expect(endOfWeek('2026-10-12')).toBe('2026-10-18');
  });

  it('today or earlier is Today', () => {
    expect(horizonForDueDate('2026-10-17', today)).toBe('HEUTE');
    expect(horizonForDueDate('2026-10-01', today)).toBe('HEUTE');
  });

  it('by Sunday is This week, after it is Later', () => {
    expect(horizonForDueDate('2026-10-18', today)).toBe('DIESE_WOCHE');
    expect(horizonForDueDate('2026-10-19', today)).toBe('SPAETER');
    expect(horizonForDueDate('2026-10-23', '2026-10-19')).toBe('DIESE_WOCHE');
  });
});
