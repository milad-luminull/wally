import { describe, expect, it } from 'vitest';
import { buildTidyInstructions, buildTidyPrompt, TIDY_INSTRUCTIONS_PREFIX } from './tidyPrompt.js';

describe('tidy prompt', () => {
  it('names today and its weekday, the zone and the language, after a byte-stable prefix', () => {
    const text = buildTidyInstructions({
      today: '2026-10-17',
      timeZone: 'Europe/Berlin',
      language: 'de',
    });
    expect(text.startsWith(TIDY_INSTRUCTIONS_PREFIX)).toBe(true);
    expect(text).toContain('Today is 2026-10-17, a Saturday, in the time zone Europe/Berlin.');
    expect(text).toContain('This week ends on Sunday 2026-10-18.');
    expect(text).toContain('Write reasons in German.');
  });

  it('lists each note on its own lines, the text cut and flattened', () => {
    const prompt = buildTidyPrompt([
      { id: 'n1', title: 'Call Müller', text: 'about the\ncontract\n' },
      { id: 'n2', title: 'Plan the offsite', text: 'x'.repeat(300) },
    ]);
    expect(prompt).toBe(
      [
        'Notes in Today, newest first:',
        'n1: Call Müller',
        '  about the contract',
        'n2: Plan the offsite',
        `  ${'x'.repeat(200)}`,
      ].join('\n'),
    );
  });

  it('says nothing about a note without text', () => {
    expect(buildTidyPrompt([{ id: 'n1', title: 'Call', text: '  ' }])).toBe(
      'Notes in Today, newest first:\nn1: Call',
    );
  });
});
