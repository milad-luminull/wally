import { describe, expect, it } from 'vitest';
import { assistantTurnRequestSchema } from '@wally/shared';

describe('the assistant turn request', () => {
  const request = { message: 'What is due?', timeZone: 'Europe/Berlin', today: '2026-10-31' };

  it('refuses a question with a NUL character before any model call is reserved', () => {
    expect(assistantTurnRequestSchema.safeParse(request).success).toBe(true);
    expect(
      assistantTurnRequestSchema.safeParse({ ...request, message: 'What\u0000 is due?' }).success,
    ).toBe(false);
  });
});
