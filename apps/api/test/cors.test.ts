import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { buildTestApp, resetDatabase, type TestContext } from './helpers.js';

describe('CORS preflight', () => {
  let ctx: TestContext;

  // The web app writes with PATCH and DELETE from another origin; if the preflight stops
  // allowing them, every edit fails in the browser while server-side tests stay green.
  it.each(['GET', 'POST', 'PATCH', 'DELETE'])('allows %s from the web origin', async (method) => {
    ctx ??= await buildTestApp();
    const res = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/whiteboards',
      headers: {
        origin: loadEnv().CORS_ORIGIN,
        'access-control-request-method': method,
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(loadEnv().CORS_ORIGIN);
    expect(String(res.headers['access-control-allow-methods']).split(/,\s*/)).toContain(method);
  });

  afterAll(async () => {
    if (ctx) {
      await resetDatabase(ctx.db);
      await ctx.app.close();
    }
  });
});
