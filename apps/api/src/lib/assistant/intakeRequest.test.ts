import { describe, expect, it } from 'vitest';
import { intakeItemSchema, intakeRequestSchema, intakeResponseSchema } from '@wally/shared';

describe('the intake contract', () => {
  const request = { message: 'call irem wed', timeZone: 'Europe/Berlin', today: '2026-11-08' };

  it('refuses a NUL, an empty message and unknown keys', () => {
    expect(intakeRequestSchema.safeParse(request).success).toBe(true);
    expect(intakeRequestSchema.safeParse({ ...request, message: 'call\u0000' }).success).toBe(
      false,
    );
    expect(intakeRequestSchema.safeParse({ ...request, message: '   ' }).success).toBe(false);
    expect(intakeRequestSchema.safeParse({ ...request, pinned: 'note' }).success).toBe(false);
  });

  it('accepts context only with both fields', () => {
    const context = { question: 'What is due?', answer: 'The renewal call.' };
    expect(intakeRequestSchema.safeParse({ ...request, context }).success).toBe(true);
    expect(
      intakeRequestSchema.safeParse({ ...request, context: { question: 'What is due?' } }).success,
    ).toBe(false);
  });

  it('a clarify needs two or three options', () => {
    const option = { label: 'New note', action: 'note', text: 'Note for Andrea' };
    const clarify = (n: number) => ({
      kind: 'clarify',
      question: 'The renewal call, or a new note?',
      options: Array.from({ length: n }, () => option),
    });
    expect(intakeItemSchema.safeParse(clarify(1)).success).toBe(false);
    expect(intakeItemSchema.safeParse(clarify(2)).success).toBe(true);
    expect(intakeItemSchema.safeParse(clarify(3)).success).toBe(true);
    expect(intakeItemSchema.safeParse(clarify(4)).success).toBe(false);
  });

  it('a response needs at least one item', () => {
    expect(intakeResponseSchema.safeParse({ items: [], truncated: false }).success).toBe(false);
    expect(
      intakeResponseSchema.safeParse({
        items: [{ kind: 'note', text: 'Call Irem' }],
        truncated: false,
      }).success,
    ).toBe(true);
  });
});
