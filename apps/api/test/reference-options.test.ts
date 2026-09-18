import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, registerTestUser, resetDatabase, type TestContext } from './helpers.js';

describe('GET /reference-options', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  it('401s without auth', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/reference-options?type=KUNDE' });
    expect(res.statusCode).toBe(401);
  });

  it('is not board-scoped — any authenticated user can list options by type', async () => {
    await ctx.prisma.referenceOption.createMany({
      data: [
        { type: 'KUNDE', label: 'Testkunde AG' },
        { type: 'VERTRAG', label: 'Testvertrag 1' },
      ],
    });
    const token = registerTestUser(ctx, 'ref-user', 'ref-user@finlex.de');

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/reference-options?type=KUNDE',
      headers: ctx.authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: expect.any(String), type: 'KUNDE', label: 'Testkunde AG' }]);
  });
});
