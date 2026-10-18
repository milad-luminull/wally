import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TidyInput, TidyOutput, TidyRunner } from '../src/lib/assistant/model/index.js';
import { modelTidySchema } from '../src/lib/assistant/model/tidy.js';
import { Timestamp } from 'firebase-admin/firestore';
import { TIDY_MAX_MOVES } from '@wally/shared';
import { assistantTidiesCol, assistantUsageCol, notesCol } from '../src/lib/db/collections.js';
import { dayKey, nextDayStart } from '../src/lib/assistant/budget/ledger.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-assistant-tidies';
const usage = { inputTokens: 50, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 };
let lastInput: TidyInput | null = null;
let calls = 0;

/**
 * The fake reads the listed notes back out of the prompt and answers like a model would: a
 * title starting with "later" goes to Later, "week" to This week, "maybe" is unsure, "fail"
 * throws the provider's error; every other note stays. Its reply gets the one check a real
 * runner's reply gets.
 */
const fakeRunner: TidyRunner = async (input): Promise<TidyOutput> => {
  lastInput = input;
  calls++;
  const lease = await input.onAttempt({ stepNumber: 0, messageCount: 1, maxOutputTokens: 512 });
  const rows = input.prompt
    .split('\n')
    .slice(1)
    .filter((line) => !line.startsWith('  '))
    .map((line) => {
      const [id, ...title] = line.split(': ');
      return { id: id!, title: title.join(': ') };
    });
  if (rows.some((r) => r.title.startsWith('fail')))
    throw Object.assign(new Error('quota for secret-project'), {
      name: 'AI_APICallError',
      statusCode: 429,
    });
  const moves = rows.flatMap((r) =>
    r.title.startsWith('later')
      ? [{ noteId: r.id, horizon: 'SPAETER', confidence: 0.9, reason: 'next month' }]
      : r.title.startsWith('week')
        ? [{ noteId: r.id, horizon: 'DIESE_WOCHE', confidence: 0.8, reason: 'by Friday' }]
        : r.title.startsWith('maybe')
          ? [{ noteId: r.id, horizon: 'SPAETER', confidence: 0.3, reason: 'maybe' }]
          : [],
  );
  await lease.settle(usage);
  const checked = modelTidySchema.safeParse({ moves });
  return { moves: checked.success ? checked.data : null, usage, finishReason: 'stop' };
};

describe('tidies', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID, { tidyRunner: fakeRunner, assistantEnabled: true });
  });
  afterEach(async () => {
    lastInput = null;
    calls = 0;
    await resetDatabase(PROJECT_ID);
  });
  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });

  // 2026-10-17 is a Saturday: this week ends on the 18th.
  const TODAY = '2026-10-17';
  const createNote = (token: string, boardId: string, body: Record<string, unknown>) =>
    ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/notes`,
      headers: ctx.authHeader(token),
      payload: body,
    });
  const tidy = (token: string, boardId: string) =>
    ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/assistant/tidies`,
      headers: ctx.authHeader(token),
      payload: { timeZone: 'Europe/Berlin', today: TODAY },
    });
  const note = async (id: string) => (await notesCol(ctx.db).doc(id).get()).data()!;
  const stored = async (userId: string, id: string) =>
    (await assistantTidiesCol(ctx.db, userId).doc(id).get()).data()!;

  it('moves dated notes by the rule without a model call, and stores one record', async () => {
    const fx = await createBoardFixture(ctx);
    const late = (
      await createNote(fx.ownerToken, fx.boardId, {
        title: 'Monday',
        dueDate: '2026-10-19',
        horizon: 'DIESE_WOCHE',
      })
    ).json();
    await createNote(fx.ownerToken, fx.boardId, {
      title: 'right',
      dueDate: '2026-10-19',
      horizon: 'SPAETER',
    });
    const res = await tidy(fx.ownerToken, fx.boardId);
    expect(res.statusCode).toBe(200);
    const { tidy: dto } = res.json();
    expect(dto).toMatchObject({
      boardId: fx.boardId,
      status: 'PENDING',
      moves: [
        {
          noteId: late.id,
          baseRevision: late.revision,
          from: 'DIESE_WOCHE',
          to: 'SPAETER',
          reason: null,
          source: 'date',
        },
      ],
      kept: null,
    });
    expect(calls).toBe(0);
    const doc = await stored(fx.ownerId, dto.id);
    expect(doc.model).toBeNull();
    expect(doc.moves[0]!.operationIds.apply).toMatch(/[0-9a-f-]{36}/);
    expect((await note(late.id)).horizon).toBe('DIESE_WOCHE');
  });

  it('asks the model about the undated notes of Today and keeps only its confident moves', async () => {
    const fx = await createBoardFixture(ctx);
    const later = (
      await createNote(fx.ownerToken, fx.boardId, {
        title: 'later: plan the offsite',
        description: 'line one\nline two',
      })
    ).json();
    await createNote(fx.ownerToken, fx.boardId, { title: 'maybe sometime' });
    await createNote(fx.ownerToken, fx.boardId, { title: 'placed', horizon: 'SPAETER' });
    const res = await tidy(fx.ownerToken, fx.boardId);
    const { tidy: dto } = res.json();
    expect(dto.moves).toEqual([
      {
        noteId: later.id,
        baseRevision: later.revision,
        from: 'HEUTE',
        to: 'SPAETER',
        reason: 'next month',
        source: 'words',
      },
    ]);
    expect(lastInput?.prompt).toContain(
      `${later.id}: later: plan the offsite\n  line one line two`,
    );
    expect(lastInput?.prompt).not.toContain('placed');
    expect(lastInput?.instructions).toContain('This week ends on Sunday 2026-10-18.');
    const usageDoc = (
      await assistantUsageCol(ctx.db, fx.ownerId).doc(dayKey(new Date())).get()
    ).data();
    expect(usageDoc?.tokens).toBe(70);
    expect(usageDoc?.inFlight).toEqual({});
    expect((await stored(fx.ownerId, dto.id)).model).toBe('vertex:gemini-2.5-flash');
  });

  it('answers null and writes nothing when there is nothing worth moving', async () => {
    const fx = await createBoardFixture(ctx);
    await createNote(fx.ownerToken, fx.boardId, { title: 'today still' });
    const res = await tidy(fx.ownerToken, fx.boardId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tidy: null });
    expect(calls).toBe(1);
    expect((await assistantTidiesCol(ctx.db, fx.ownerId).get()).size).toBe(0);
  });

  it('a viewer tidies only their own private notes, and a second request discards the first', async () => {
    const fx = await createBoardFixture(ctx);
    await createNote(fx.ownerToken, fx.boardId, { title: 'later: shared', dueDate: '2026-11-01' });
    // A viewer may only write private notes.
    const mine = (
      await createNote(fx.viewToken, fx.boardId, { title: 'later: mine', visibility: 'PRIVATE' })
    ).json();
    const first = (await tidy(fx.viewToken, fx.boardId)).json().tidy;
    expect(first.moves.map((m: { noteId: string }) => m.noteId)).toEqual([mine.id]);
    const second = (await tidy(fx.viewToken, fx.boardId)).json().tidy;
    expect(second.id).not.toBe(first.id);
    expect((await stored(fx.viewerId, first.id)).status).toBe('DISCARDED');
  });

  it('the provider’s failure is a 502 without its words, and a budget refusal a 429', async () => {
    const fx = await createBoardFixture(ctx);
    await createNote(fx.ownerToken, fx.boardId, { title: 'fail now' });
    const res = await tidy(fx.ownerToken, fx.boardId);
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('secret-project');

    const day = dayKey(new Date());
    await assistantUsageCol(ctx.db, fx.ownerId)
      .doc(day)
      .set({ tokens: 300_000, inFlight: {}, updatedAt: Timestamp.now() });
    await createNote(fx.ownerToken, fx.boardId, { title: 'later: refused' });
    const refused = await tidy(fx.ownerToken, fx.boardId);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({
      error: 'ASSISTANT_DAILY_CAP',
      resetsAt: nextDayStart(day).toISOString(),
    });
    expect((await assistantTidiesCol(ctx.db, fx.ownerId).get()).size).toBe(0);
  });

  it('holds at most the moves a batch may carry, the earliest due first', async () => {
    const fx = await createBoardFixture(ctx);
    // Every note is due after this week but sits in Today: each one is a move by date.
    const ids: string[] = [];
    for (let i = 0; i < TIDY_MAX_MOVES + 1; i++) {
      const dueDate = new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);
      ids.push(
        (await createNote(fx.ownerToken, fx.boardId, { title: `dated ${i}`, dueDate })).json().id,
      );
    }
    const res = await tidy(fx.ownerToken, fx.boardId);
    expect(res.statusCode).toBe(200);
    const { moves } = res.json().tidy;
    expect(moves.map((m: { noteId: string }) => m.noteId)).toEqual(ids.slice(0, TIDY_MAX_MOVES));
    expect(calls).toBe(0);
  });

  it('is not found when the assistant is off for the board', async () => {
    const fx = await createBoardFixture(ctx);
    await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}/assistant`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { enabled: false },
    });
    expect((await tidy(fx.ownerToken, fx.boardId)).statusCode).toBe(404);
  });
});
