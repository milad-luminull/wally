import { describe, expect, it } from 'vitest';
import { guessIntent } from './intentGuess';

describe('guessIntent', () => {
  it('reads a question without a question mark as an ask', () => {
    expect(guessIntent("what's blocking munich")).toBe('ask');
    expect(guessIntent('Who is on the board slides')).toBe('ask');
  });

  it('reads a lookup request as an ask, in English and German', () => {
    expect(guessIntent("show me what's overdue")).toBe('ask');
    expect(guessIntent('zeig mir was überfällig ist')).toBe('ask');
    expect(guessIntent('Was ist freitag fällig')).toBe('ask');
  });

  it('reads a task as a note', () => {
    expect(guessIntent('call irem wed')).toBe('note');
    expect(guessIntent('irem mittwoch anrufen')).toBe('note');
  });

  it('reads a task ending in a question mark as a note', () => {
    expect(guessIntent('ask tom re budget?')).toBe('note');
    expect(guessIntent('frag tom wegen budget?')).toBe('note');
  });

  it('reads other text ending in a question mark as an ask', () => {
    expect(guessIntent('budget for the offsite?')).toBe('ask');
  });

  it('reads nothing as a note', () => {
    expect(guessIntent('')).toBe('note');
    expect(guessIntent('   ')).toBe('note');
  });
});
