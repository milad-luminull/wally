import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-health';

describe('GET /health', () => {
  let ctx: TestContext;

  it('returns 200 with no auth header at all', async () => {
    ctx = await buildTestApp(PROJECT_ID);
    const res = await ctx.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  afterAll(async () => {
    if (ctx) {
      await resetDatabase(PROJECT_ID);
      await ctx.app.close();
    }
  });
});
