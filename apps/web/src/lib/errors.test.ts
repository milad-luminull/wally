import { describe, expect, it } from 'vitest';
import { ApiError, RequestTimeoutError } from './apiClient';
import { failureOf } from './errors';

const api = (status: number, error?: string, extra: Record<string, unknown> = {}) =>
  new ApiError(status, error ? { error, message: 'x', retryable: false, ...extra } : null);

describe('failureOf: every failure is one of five kinds', () => {
  it('a 401 that survived a fresh token is a failure to retry, never a sign-out', () => {
    // The API cannot tell a revoked session from its own verifier failing; a session that
    // really ended is signed out by Firebase itself (AuthProvider says so on the sign-in page).
    expect(failureOf(api(401, 'UNAUTHORIZED'))).toEqual({
      kind: 'temporary',
      code: 'UNAUTHORIZED',
    });
  });
  it('a conflict the person reviews', () => {
    expect(failureOf(api(409, 'STALE_REVISION'))?.kind).toBe('conflict');
    expect(failureOf(Object.assign(new Error('blocked'), { code: 'MUTATION_BLOCKED' }))?.kind).toBe(
      'conflict',
    );
  });
  it('a limit with the time it lifts', () => {
    expect(
      failureOf(api(429, 'ASSISTANT_DAILY_CAP', { resetsAt: '2026-10-20T00:00:00Z' })),
    ).toEqual({
      kind: 'limit',
      code: 'ASSISTANT_DAILY_CAP',
      resetsAt: '2026-10-20T00:00:00Z',
    });
    expect(failureOf(api(429, 'ASSISTANT_MONTHLY_CAP'))?.kind).toBe('limit');
  });
  it('temporary: busy, rate limited, a fault, a timeout, a dropped connection', () => {
    for (const error of [
      api(429, 'RATE_LIMITED'),
      api(429, 'ASSISTANT_BUSY'),
      api(502, 'ASSISTANT_PROVIDER_ERROR'),
      api(504, 'ASSISTANT_TIMEOUT'),
      api(500, 'INTERNAL_SERVER_ERROR'),
      api(503),
      new RequestTimeoutError(),
      new TypeError('Failed to fetch'),
    ])
      expect(failureOf(error)?.kind).toBe('temporary');
    expect(failureOf(new RequestTimeoutError())?.code).toBe('TIMEOUT');
    expect(failureOf(new TypeError('Failed to fetch'))?.code).toBe('NETWORK');
  });
  it('refused: no permission, gone, invalid, or any other 4xx', () => {
    for (const error of [
      api(403, 'FORBIDDEN'),
      api(404, 'NOT_FOUND'),
      api(422, 'INVALID_ASSIGNEE'),
      api(400, 'BAD_REQUEST'),
      api(409, 'IDEMPOTENCY_KEY_REUSED'),
    ])
      expect(failureOf(error)?.kind).toBe('refused');
  });
  it('an answer the app could not read is temporary, not refused', () => {
    expect(
      failureOf(new ApiError(200, { odd: true }, 'Response failed schema validation'))?.kind,
    ).toBe('temporary');
  });
  it('a request the session itself cancelled is no failure at all', () => {
    expect(failureOf(new DOMException('Account changed', 'AbortError'))).toBeNull();
  });
});

describe('ApiError reads the body', () => {
  it('keeps retryable and resetsAt', () => {
    const error = api(429, 'ASSISTANT_DAILY_CAP', { resetsAt: '2026-10-20T00:00:00Z' });
    expect(error.resetsAt).toBe('2026-10-20T00:00:00Z');
    expect(api(502, 'ASSISTANT_PROVIDER_ERROR', { retryable: true }).retryable).toBe(true);
  });
});
