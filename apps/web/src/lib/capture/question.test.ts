import { describe, expect, it } from 'vitest';
import { isQuestion, questionOf } from './question';

describe('questionOf', () => {
  it('reads a title ending in a question mark as a question', () => {
    expect(isQuestion('What is open today?')).toBe(true);
    expect(isQuestion('What is open today? ')).toBe(true);
    expect(questionOf('  What is open today?  ', '')).toBe('What is open today?');
  });

  it('reads anything else as a note', () => {
    expect(isQuestion('Call Müller')).toBe(false);
    expect(isQuestion('Ask Anna? today')).toBe(false);
    expect(isQuestion('?')).toBe(true);
    expect(questionOf('Call Müller', 'Why?')).toBeNull();
  });

  it('carries the text line with the question, after a blank line', () => {
    expect(questionOf('Which are overdue?', '  Only mine  ')).toBe(
      'Which are overdue?\n\nOnly mine',
    );
    expect(questionOf('Which are overdue?', '   ')).toBe('Which are overdue?');
  });
});
