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

  it('flattens and trims the title as it does the text; an empty title leaves the id alone', () => {
    expect(
      buildTidyPrompt([
        { id: 'n1', title: '  Call\n  Müller \t', text: '' },
        { id: 'n2', title: '   ', text: 'only text' },
      ]),
    ).toBe(['Notes in Today, newest first:', 'n1: Call Müller', 'n2:', '  only text'].join('\n'));
  });

  it('on a Sunday says that the week ends today, so every later date is Later', () => {
    const sunday = buildTidyInstructions({
      today: '2026-10-18',
      timeZone: 'Europe/Berlin',
      language: 'en',
    });
    expect(sunday).toContain(
      'Today is Sunday: the week ends today, so every later date is Later (SPAETER).',
    );
    expect(
      buildTidyInstructions({ today: '2026-10-17', timeZone: 'Europe/Berlin', language: 'en' }),
    ).not.toContain('Today is Sunday');
  });

  it('says nothing about a note without text', () => {
    expect(buildTidyPrompt([{ id: 'n1', title: 'Call', text: '  ' }])).toBe(
      'Notes in Today, newest first:\nn1: Call',
    );
  });
});
