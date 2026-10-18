import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { isFinalRefusal } from './tidy.js';

describe('isFinalRefusal', () => {
  it('skips a note the command layer refuses for good: forbidden, gone, changed, unprocessable', () => {
    for (const status of [403, 404, 409, 422])
      expect(isFinalRefusal(new AppError(status, 'X', 'refused'))).toBe(true);
  });

  it('never takes a bad request, a missing precondition or a server error for a skip', () => {
    for (const status of [400, 428, 500, 503])
      expect(isFinalRefusal(new AppError(status, 'X', 'failed'))).toBe(false);
    expect(isFinalRefusal(new Error('network'))).toBe(false);
  });
});
