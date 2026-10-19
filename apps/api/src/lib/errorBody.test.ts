import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from '@wally/shared';
import { AppError } from './errors.js';
import { BudgetError } from './assistant/budget/ledger.js';
import { errorReplyFor } from './errorBody.js';

describe('errorReplyFor: one body for every failure', () => {
  const cases: [string, unknown, number, string, boolean][] = [
    [
      'an AppError keeps its status and code',
      new AppError(403, 'FORBIDDEN', 'No'),
      403,
      'FORBIDDEN',
      false,
    ],
    [
      'a rate limit is worth retrying',
      new AppError(429, 'RATE_LIMITED', 'Too many requests'),
      429,
      'RATE_LIMITED',
      true,
    ],
    [
      'a provider failure is worth retrying',
      new AppError(502, 'ASSISTANT_PROVIDER_ERROR', 'x'),
      502,
      'ASSISTANT_PROVIDER_ERROR',
      true,
    ],
    [
      'a model timeout is worth retrying',
      new AppError(504, 'ASSISTANT_TIMEOUT', 'x'),
      504,
      'ASSISTANT_TIMEOUT',
      true,
    ],
    [
      'a busy ledger is worth retrying',
      new BudgetError('ASSISTANT_BUSY', null),
      429,
      'ASSISTANT_BUSY',
      true,
    ],
    [
      'a Firestore NOT_FOUND is a 404',
      Object.assign(new Error('gone'), { code: 5 }),
      404,
      'NOT_FOUND',
      false,
    ],
    [
      'a body too large is named',
      Object.assign(new Error('big'), { statusCode: 413 }),
      413,
      'PAYLOAD_TOO_LARGE',
      false,
    ],
    [
      'an unsupported type is named',
      Object.assign(new Error('t'), { statusCode: 415 }),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      false,
    ],
    [
      'a framework 400 is BAD_REQUEST',
      Object.assign(new Error('bad'), { statusCode: 400 }),
      400,
      'BAD_REQUEST',
      false,
    ],
    [
      'another 4xx is REQUEST_FAILED',
      Object.assign(new Error('?'), { statusCode: 418 }),
      418,
      'REQUEST_FAILED',
      false,
    ],
    ['an unknown error is a retryable 500', new Error('boom'), 500, 'INTERNAL_SERVER_ERROR', true],
  ];
  it.each(cases)('%s', (_name, error, status, code, retryable) => {
    const reply = errorReplyFor(error);
    expect(reply.status).toBe(status);
    expect(reply.body).toMatchObject({ error: code, retryable });
    expect(apiErrorSchema.parse(reply.body)).toEqual(reply.body);
  });

  it('carries the reset time of a budget cap, which waiting fixes and a retry does not', () => {
    const resetsAt = new Date('2026-10-20T00:00:00Z');
    const reply = errorReplyFor(new BudgetError('ASSISTANT_DAILY_CAP', resetsAt));
    expect(reply.body).toEqual({
      error: 'ASSISTANT_DAILY_CAP',
      message: 'Assistant budget reached',
      retryable: false,
      resetsAt: resetsAt.toISOString(),
    });
  });

  it('never sends the text of an unknown error', () => {
    expect(errorReplyFor(new Error('secret detail')).body.message).toBe('Unexpected error');
  });
});
