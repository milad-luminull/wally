import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BudgetError,
  dayKey,
  MAX_IN_FLIGHT,
  monthKey,
  nextDayStart,
  reserveAttempt,
  settleAttempt,
} from '../src/lib/assistant/budget/ledger.js';
import {
  assistantAttemptsCol,
  assistantSpendCol,
  assistantUsageCol,
} from '../src/lib/db/collections.js';
import { buildTestApp, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-assistant-budget';
const price = { inputMicroUsdPerToken: 1.5, outputMicroUsdPerToken: 7.5 };
const caps = { dailyTokens: 10_000, monthlyMicroUsd: 1_000_000 };
const now = new Date('2026-10-15T10:00:00.000Z');
const estimate = { inputTokens: 2_000, outputTokens: 1_000 }; // 3000 tokens, 10500 micro-USD

describe('assistant budget ledger', () => {
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
  const reserve = (userId = 'u1', overrides: Partial<Parameters<typeof reserveAttempt>[1]> = {}) =>
    reserveAttempt(ctx.db, { userId, now, estimate, price, caps, ...overrides });

  it('reserves tokens and money, then settles with actual usage exactly once', async () => {
    const r = await reserve();
    expect(r).toMatchObject({
      day: '2026-10-15',
      month: '2026-10',
      reservedTokens: 3000,
      reservedMicroUsd: 10500,
    });
    expect((await assistantUsageCol(ctx.db, 'u1').doc(r.day).get()).data()).toMatchObject({
      tokens: 3000,
    });
    expect((await assistantSpendCol(ctx.db).doc(r.month).get()).data()).toMatchObject({
      microUsd: 10500,
    });

    await settleAttempt(ctx.db, 'u1', r.attemptId, { inputTokens: 1_200, outputTokens: 100 }, now);
    expect((await assistantUsageCol(ctx.db, 'u1').doc(r.day).get()).data()).toMatchObject({
      tokens: 1300,
      inFlight: {},
    });
    expect((await assistantSpendCol(ctx.db).doc(r.month).get()).data()).toMatchObject({
      microUsd: 2550,
    });
    const attempt = (await assistantAttemptsCol(ctx.db, 'u1').doc(r.attemptId).get()).data();
    expect(attempt).toMatchObject({ state: 'SETTLED', settledTokens: 1300, settledMicroUsd: 2550 });

    await settleAttempt(
      ctx.db,
      'u1',
      r.attemptId,
      { inputTokens: 9_999, outputTokens: 9_999 },
      now,
    );
    expect((await assistantUsageCol(ctx.db, 'u1').doc(r.day).get()).data()).toMatchObject({
      tokens: 1300,
    });
    expect((await assistantSpendCol(ctx.db).doc(r.month).get()).data()).toMatchObject({
      microUsd: 2550,
    });
  });

  it('refuses the daily token cap with the reset time and leaves nothing reserved', async () => {
    const first = await reserve('u1', { estimate: { inputTokens: 7_000, outputTokens: 1_000 } });
    await settleAttempt(
      ctx.db,
      'u1',
      first.attemptId,
      { inputTokens: 7_000, outputTokens: 1_000 },
      now,
    );
    await expect(reserve()).rejects.toMatchObject({
      statusCode: 429,
      code: 'ASSISTANT_DAILY_CAP',
      resetsAt: nextDayStart('2026-10-15').toISOString(),
    } satisfies Partial<BudgetError>);
    expect((await assistantUsageCol(ctx.db, 'u1').doc('2026-10-15').get()).data()).toMatchObject({
      tokens: 8000,
      inFlight: {},
    });
    expect((await assistantAttemptsCol(ctx.db, 'u1').get()).size).toBe(1);
  });

  it('refuses the monthly money cap on the deployment key only', async () => {
    const tight = { dailyTokens: 1_000_000, monthlyMicroUsd: 20_000 };
    await reserve('u1', { caps: tight });
    await expect(reserve('u2', { caps: tight })).rejects.toMatchObject({
      code: 'ASSISTANT_MONTHLY_CAP',
    });
    // A user's own key counts tokens only; money is not reserved.
    const own = await reserve('u3', { caps: tight, price: null });
    expect(own.reservedMicroUsd).toBe(0);
    expect((await assistantSpendCol(ctx.db).doc('2026-10').get()).data()).toMatchObject({
      microUsd: 10500,
    });
  });

  it('allows at most two attempts in flight per user and frees a slot on settlement or lease expiry', async () => {
    const a = await reserve();
    const b = await reserve();
    expect(MAX_IN_FLIGHT).toBe(2);
    await expect(reserve()).rejects.toMatchObject({ code: 'ASSISTANT_BUSY', resetsAt: null });
    await settleAttempt(ctx.db, 'u1', a.attemptId, { inputTokens: 10, outputTokens: 10 }, now);
    const c = await reserve();
    expect(c.attemptId).not.toBe(b.attemptId);
    // b and c are stuck; after the lease expires a new reservation prunes them.
    const later = new Date(now.getTime() + 121_000);
    const d = await reserve('u1', { now: later });
    const usage = (await assistantUsageCol(ctx.db, 'u1').doc(dayKey(later)).get()).data();
    expect(Object.keys(usage!.inFlight)).toEqual([d.attemptId]);
    // Stuck attempts keep their worst-case charge.
    expect(usage!.tokens).toBe(4 * 3000 - (3000 - 20));
  });

  it('a late settlement adjusts the day it was reserved on, not the current day', async () => {
    const r = await reserve();
    const nextDay = new Date('2026-10-16T01:00:00.000Z');
    await settleAttempt(ctx.db, 'u1', r.attemptId, { inputTokens: 100, outputTokens: 50 }, nextDay);
    expect((await assistantUsageCol(ctx.db, 'u1').doc('2026-10-15').get()).data()).toMatchObject({
      tokens: 150,
    });
    expect((await assistantUsageCol(ctx.db, 'u1').doc('2026-10-16').get()).exists).toBe(false);
    expect(monthKey(nextDay)).toBe('2026-10');
  });

  it('never overshoots a cap under concurrent reservations', async () => {
    const single = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        reserveAttempt(ctx.db, {
          userId: 'solo',
          now,
          estimate: { inputTokens: 100, outputTokens: 0 },
          price,
          caps: { dailyTokens: 350, monthlyMicroUsd: 1_000_000 },
        }).then(async (r) => {
          await settleAttempt(
            ctx.db,
            'solo',
            r.attemptId,
            { inputTokens: 100, outputTokens: 0 },
            now,
          );
          return r;
        }),
      ),
    );
    const ok = single.filter((s) => s.status === 'fulfilled').length;
    expect(ok).toBe(3);
    expect((await assistantUsageCol(ctx.db, 'solo').doc('2026-10-15').get()).data()!.tokens).toBe(
      300,
    );
  });
});
