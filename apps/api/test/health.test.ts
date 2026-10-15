import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { _resetEnvCacheForTests } from '../src/env.js';
import {
  buildTestApp,
  createFakeAuthVerifier,
  getTestDb,
  resetDatabase,
  type TestContext,
} from './helpers.js';

const PROJECT_ID = 'wally-test-health';

describe('GET /health', () => {
  let ctx: TestContext;

  it('returns 200 with no auth header at all', async () => {
    ctx = await buildTestApp(PROJECT_ID);
    const res = await ctx.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      assistant: { enabled: false, model: 'vertex:gemini-3.8-flash' },
    });
  });

  afterAll(async () => {
    if (ctx) {
      await resetDatabase(PROJECT_ID);
      await ctx.app.close();
    }
  });
});

describe('boot with a malformed ASSISTANT_MODEL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetEnvCacheForTests();
  });

  // server.ts awaits buildApp() outside its try block, so a rejection here reaches
  // main().catch and exits the process before it listens.
  it.each([
    ['openai:gpt', /Unknown assistant provider "openai"/],
    ['vertex', /ASSISTANT_MODEL must be provider:model/],
    ['vertex:a:b', /Invalid assistant model id/],
  ])('refuses to build the app for %s', async (value, message) => {
    vi.stubEnv('ASSISTANT_MODEL', value);
    _resetEnvCacheForTests();
    const { verifier } = createFakeAuthVerifier();
    let failure: unknown;
    try {
      const app = await buildApp({
        db: getTestDb(PROJECT_ID),
        authVerifier: verifier,
        logger: false,
      });
      await app.close();
    } catch (err) {
      failure = err;
    }
    expect(failure, 'buildApp resolved; the reference is not parsed at boot').toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(message);
  });
});
