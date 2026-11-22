import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiErrorSchema } from '@wally/shared';
import type { SuggestionRunner } from '../src/lib/assistant/model/index.js';
import { _resetEnvCacheForTests } from '../src/env.js';
import {
  buildTestApp,
  createBoardFixture,
  resetDatabase,
  type TestContext,
  untilAborted,
} from './helpers.js';

describe('error bodies on the wire', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp();
  });
  afterAll(async () => {
    await resetDatabase(ctx.db);
    await ctx.app.close();
  });

  it('answers an unknown route with the same body as every other error', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/no-such-route',
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json())).toMatchObject({
      error: 'NOT_FOUND',
      retryable: false,
    });
  });

  it('answers an invalid body with BAD_REQUEST, not retryable', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { name: 42 },
    });
    expect(res.statusCode).toBe(400);
    expect(apiErrorSchema.parse(res.json())).toMatchObject({
      error: 'BAD_REQUEST',
      retryable: false,
    });
  });

  it('answers a missing or invalid token with the same body, not retryable', async () => {
    const missing = await ctx.app.inject({ method: 'GET', url: '/me' });
    expect(missing.statusCode).toBe(401);
    expect(apiErrorSchema.parse(missing.json())).toMatchObject({
      error: 'UNAUTHORIZED',
      retryable: false,
    });
    const invalid = await ctx.app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer not-a-token' },
    });
    expect(invalid.statusCode).toBe(401);
    expect(apiErrorSchema.parse(invalid.json())).toMatchObject({ error: 'UNAUTHORIZED' });
  });
});

/**
 * RFC-0012 §5.2: an unexpected failure logs at `error` with its `err`; an expected one (an
 * AppError 502, 503 or 504) at `warn`, by its code alone. An AppError 500 is a bug.
 */
describe('the error log line', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    _resetEnvCacheForTests();
  });

  type Options = Parameters<typeof buildTestApp>[0];
  /** Runs one failing request on its own app and returns its "Request failed" line. */
  async function failedLine(
    options: Options,
    act: (ctx: TestContext) => Promise<{ statusCode: number }>,
    status: number,
  ) {
    const lines: string[] = [];
    const ctx = await buildTestApp({ ...options, logLines: lines });
    try {
      expect((await act(ctx)).statusCode).toBe(status);
    } finally {
      await ctx.app.close();
    }
    const failed = lines
      .map(
        (line) => JSON.parse(line) as Record<string, unknown> & { 'exception.stacktrace'?: string },
      )
      .filter((line) => line.message === 'Request failed');
    expect(failed).toHaveLength(1);
    return failed[0]!;
  }

  /** A capture of a fresh note, which calls the suggestion runner once. */
  async function capture(ctx: TestContext) {
    const fx = await createBoardFixture(ctx);
    const note = (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { title: 'Plan the launch' },
      })
    ).json();
    return ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/assistant/captures`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { noteId: note.id, locked: [], timeZone: 'Europe/Berlin', today: '2026-10-17' },
    });
  }

  const failing: SuggestionRunner = async (input) => {
    await input.onAttempt({ stepNumber: 0, messageCount: 1, maxOutputTokens: 256 });
    throw Object.assign(new Error('the provider echoed secret-prompt'), { statusCode: 500 });
  };
  const slow: SuggestionRunner = async (input) => {
    await input.onAttempt({ stepNumber: 0, messageCount: 1, maxOutputTokens: 256 });
    await untilAborted(input.abortSignal);
    throw new DOMException('aborted', 'AbortError');
  };

  it('logs an unexpected 500 at error with its stack', async () => {
    const line = await failedLine(
      {},
      async (ctx) => {
        const fx = await createBoardFixture(ctx);
        vi.spyOn(ctx.db, 'transaction').mockRejectedValue(new Error('kaboom'));
        return ctx.inject({
          method: 'PATCH',
          url: `/whiteboards/${fx.boardId}`,
          headers: ctx.authHeader(fx.ownerToken),
          payload: { name: 'Renamed' },
        });
      },
      500,
    );
    expect(line).toMatchObject({
      severity: 'ERROR',
      message: 'Request failed',
      'exception.type': 'Error',
      'exception.message': 'kaboom',
      'error.type': 'Error',
      'http.response.status_code': 500,
    });
    expect(line['exception.stacktrace']).toContain('kaboom');
    expect(line['http.route']).toMatch(/^\//);
  });

  it('logs an AppError 500 at error', async () => {
    vi.stubEnv('ASSISTANT_MODEL', 'vertex:gemini-unpriced');
    _resetEnvCacheForTests();
    const line = await failedLine(
      { suggestionRunner: failing, assistantEnabled: true },
      capture,
      500,
    );
    expect(line).toMatchObject({
      severity: 'ERROR',
      'exception.type': 'AppError',
      'error.type': 'ASSISTANT_PRICE_MISSING',
      'http.response.status_code': 500,
    });
  });

  it.each([
    [
      502,
      { suggestionRunner: failing, assistantEnabled: true, assistantDeadlineMs: 3_000 },
      capture,
    ],
    [503, {}, (ctx: TestContext) => ctx.app.inject({ method: 'POST', url: '/mcp', payload: {} })],
    [504, { suggestionRunner: slow, assistantEnabled: true, assistantDeadlineMs: 50 }, capture],
  ] as const)('logs an AppError %i at warn, without a stack', async (status, options, act) => {
    const line = await failedLine(options, act, status);
    expect(line).toMatchObject({
      severity: 'WARNING',
      message: 'Request failed',
      'http.response.status_code': status,
    });
    expect(line['error.type']).toEqual(expect.any(String));
    expect(line).not.toHaveProperty('exception.stacktrace');
    expect(JSON.stringify(line)).not.toContain('secret-prompt');
  });
});
