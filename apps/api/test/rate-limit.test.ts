import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, registerTestUser, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-rate-limit';

/** Matches the per-route budget in src/routes/share-links.ts. */
const REDEEM_LIMIT = 20;

describe('rate limiting', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID);
  });

  afterEach(async () => {
    await resetDatabase(PROJECT_ID);
  });

  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });

  /** Redeeming a nonexistent token 404s, which is enough to consume the budget. */
  async function redeem(token: string) {
    return ctx.app.inject({
      method: 'POST',
      url: '/share-links/no-such-token/redeem',
      headers: ctx.authHeader(token),
    });
  }

  it('cuts off a caller who hammers the redeem route', async () => {
    const token = registerTestUser(ctx, 'rl-hammer', 'hammer@finlex.de');

    for (let i = 0; i < REDEEM_LIMIT; i += 1) {
      expect((await redeem(token)).statusCode).toBe(404);
    }

    const blocked = await redeem(token);
    expect(blocked.statusCode).toBe(429);
    // The app's own error envelope, not the plugin's default shape, so the client's
    // ApiError branching keeps working.
    expect(blocked.json()).toMatchObject({ error: 'RATE_LIMITED' });
  });

  it('charges the budget to the caller, not to everyone sharing their address', async () => {
    const hammer = registerTestUser(ctx, 'rl-hammer-2', 'hammer2@finlex.de');
    for (let i = 0; i <= REDEEM_LIMIT; i += 1) await redeem(hammer);
    expect((await redeem(hammer)).statusCode).toBe(429);

    // inject() gives every request the same IP, so an IP-keyed limiter would have locked
    // this caller out too — which behind Cloud Run's proxy would mean locking out everyone.
    const bystander = registerTestUser(ctx, 'rl-bystander', 'bystander@finlex.de');
    expect((await redeem(bystander)).statusCode).toBe(404);
  });

  it('leaves ordinary board traffic well clear of the global budget', async () => {
    const token = registerTestUser(ctx, 'rl-normal', 'normal@finlex.de');

    for (let i = 0; i < 40; i += 1) {
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) }))
          .statusCode,
      ).toBe(200);
    }
  });
});
