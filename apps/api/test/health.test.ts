import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp, resetDatabase, type TestContext } from './helpers.js';

describe('GET /healthz', () => {
  let ctx: TestContext;

  it('returns 200 with no auth header at all', async () => {
    ctx = await buildTestApp();
    const res = await ctx.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  afterAll(async () => {
    if (ctx) {
      await resetDatabase(ctx.prisma);
      await ctx.app.close();
    }
  });
});
