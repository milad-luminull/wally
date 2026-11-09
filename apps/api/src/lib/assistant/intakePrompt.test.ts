import { describe, expect, it } from 'vitest';
import {
  buildIntakeInstructions,
  buildIntakePrompt,
  INTAKE_INSTRUCTIONS_PREFIX,
} from './intakePrompt.js';

describe('intake prompt', () => {
  it('the prefix holds no board content and no date', () => {
    const text = buildIntakeInstructions({
      today: '2026-11-08',
      timeZone: 'Europe/Berlin',
      language: 'de',
    });
    expect(text.startsWith(INTAKE_INSTRUCTIONS_PREFIX)).toBe(true);
    expect(INTAKE_INSTRUCTIONS_PREFIX).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).toContain('Today is 2026-11-08, a Sunday, in the time zone Europe/Berlin.');
    expect(text).toContain('Write questions and option labels in German.');
  });

  it('the prompt lists notes as id: title lines, the context block only when given', () => {
    const notes = [
      { id: 'n1', title: 'Update the premium table' },
      { id: 'n2', title: '  Call\n Andrea ' },
    ];
    expect(buildIntakePrompt({ message: 'and next week?', notes })).toBe(
      [
        'Message:',
        'and next week?',
        'Open notes on this board, newest first:',
        'n1: Update the premium table',
        'n2: Call Andrea',
      ].join('\n'),
    );
    expect(
      buildIntakePrompt({
        message: 'and next week?',
        context: { question: 'What is due?', answer: 'The renewal call.' },
        notes: [],
      }),
    ).toBe(
      [
        'Message:',
        'and next week?',
        'Showing in the box:',
        'Question: What is due?',
        'Answer: The renewal call.',
        'Open notes on this board, newest first: none',
      ].join('\n'),
    );
  });
});
