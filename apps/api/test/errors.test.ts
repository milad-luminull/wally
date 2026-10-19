import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiErrorSchema } from '@wally/shared';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-errors';

describe('error bodies on the wire', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID);
  });
  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
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
});
