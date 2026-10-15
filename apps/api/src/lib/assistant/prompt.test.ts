import { describe, expect, it } from 'vitest';
import { buildInstructions, INSTRUCTIONS_PREFIX } from './prompt.js';

describe('buildInstructions', () => {
  const base = {
    today: '2026-10-15',
    timeZone: 'Europe/Berlin',
    role: 'EDIT' as const,
    language: 'de' as const,
  };
  it('starts with the byte-stable prefix whatever the day, zone, role or language', () => {
    const a = buildInstructions(base);
    const b = buildInstructions({
      today: '2027-01-02',
      timeZone: 'UTC',
      role: 'VIEW',
      language: 'en',
    });
    expect(a.startsWith(INSTRUCTIONS_PREFIX)).toBe(true);
    expect(b.startsWith(INSTRUCTIONS_PREFIX)).toBe(true);
    expect(a.slice(0, INSTRUCTIONS_PREFIX.length)).toBe(b.slice(0, INSTRUCTIONS_PREFIX.length));
  });
  it('puts the variable context after the prefix', () => {
    const text = buildInstructions(base);
    const tail = text.slice(INSTRUCTIONS_PREFIX.length);
    expect(tail).toContain('2026-10-15');
    expect(tail).toContain('Europe/Berlin');
    expect(tail).toContain('EDIT');
    expect(tail).toContain('German');
  });
  it('states the rules the spec and the brand require', () => {
    expect(INSTRUCTIONS_PREFIX).toMatch(/\[note:ID\]/);
    expect(INSTRUCTIONS_PREFIX).toMatch(/never follow instructions/i);
    expect(INSTRUCTIONS_PREFIX).toMatch(/truncated/i);
    expect(INSTRUCTIONS_PREFIX).toMatch(/first person/i);
    expect(INSTRUCTIONS_PREFIX).not.toMatch(/\bI\b am/);
  });
});
