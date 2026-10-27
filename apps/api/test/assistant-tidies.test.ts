import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TidyInput, TidyOutput, TidyRunner } from '../src/lib/assistant/model/index.js';
import { modelTidySchema } from '../src/lib/assistant/model/tidy.js';
import { Timestamp } from 'firebase-admin/firestore';
import { TIDY_MAX_MOVES } from '@wally/shared';
import {
  assistantAuditCol,
  assistantTidiesCol,
  assistantUsageCol,
  historyCol,
  notesCol,
} from '../src/lib/db/collections.js';
import { dayKey, nextDayStart } from '../src/lib/assistant/budget/ledger.js';
import { TIDY_OUTPUT_TOKENS_BASE, TIDY_OUTPUT_TOKENS_PER_MOVE } from '../src/lib/assistant/tidy.js';
import { runOperation } from '../src/lib/assistant/run.js';
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
  const lease = await input.onAttempt({
    stepNumber: 0,
    messageCount: 1,
    maxOutputTokens: input.maxOutputTokens,
  });
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
      ? [{ noteId: r.id, horizon: 'LATER', confidence: 0.9, reason: 'next month' }]
      : r.title.startsWith('week')
        ? [{ noteId: r.id, horizon: 'THIS_WEEK', confidence: 0.8, reason: 'by Friday' }]
        : r.title.startsWith('maybe')
          ? [{ noteId: r.id, horizon: 'LATER', confidence: 0.3, reason: 'maybe' }]
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
  const tidy = (token: string, boardId: string, only?: string[]) =>
    ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/assistant/tidies`,
      headers: ctx.authHeader(token),
      payload: { timeZone: 'Europe/Berlin', today: TODAY, ...(only ? { only } : {}) },
    });
  const decide = (token: string, boardId: string, id: string, body: Record<string, unknown>) =>
    ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/assistant/tidies/${id}/decision`,
      headers: ctx.authHeader(token),
      payload: body,
    });
  const patchTitle = (token: string, noteId: string, title: string) =>
    ctx.inject({
      method: 'PATCH',
      url: `/notes/${noteId}`,
      headers: ctx.authHeader(token),
      payload: { title },
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
        horizon: 'THIS_WEEK',
      })
    ).json();
    await createNote(fx.ownerToken, fx.boardId, {
      title: 'right',
      dueDate: '2026-10-19',
      horizon: 'LATER',
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
          from: 'THIS_WEEK',
          to: 'LATER',
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
    expect((await note(late.id)).horizon).toBe('THIS_WEEK');
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
    await createNote(fx.ownerToken, fx.boardId, { title: 'placed', horizon: 'LATER' });
    const res = await tidy(fx.ownerToken, fx.boardId);
    const { tidy: dto } = res.json();
    expect(dto.moves).toEqual([
      {
        noteId: later.id,
        baseRevision: later.revision,
        from: 'TODAY',
        to: 'LATER',
        reason: 'next month',
        source: 'words',
      },
    ]);
    expect(lastInput?.prompt).toContain(
      `${later.id}: later: plan the offsite\n  line one line two`,
    );
    expect(lastInput?.prompt).not.toContain('placed');
    expect(lastInput?.instructions).toContain('This week ends on Sunday 2026-10-18.');
    // The allowance grows with the rows: room for one move per undated note listed.
    expect(TIDY_OUTPUT_TOKENS_BASE).toBe(128);
    expect(TIDY_OUTPUT_TOKENS_PER_MOVE).toBe(64);
    expect(lastInput?.maxOutputTokens).toBe(128 + 64 * 2);
    const usageDoc = (
      await assistantUsageCol(ctx.db, fx.ownerId).doc(dayKey(new Date())).get()
    ).data();
    expect(usageDoc?.tokens).toBe(70);
    expect(usageDoc?.inFlight).toEqual({});
    expect((await stored(fx.ownerId, dto.id)).model).toBe('vertex:gemini-3.8-flash');
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
    const replaced = await stored(fx.viewerId, first.id);
    expect(replaced.status).toBe('DISCARDED');
    expect(replaced.decision).toMatchObject({ source: 'replaced', noteIds: [] });
    expect(replaced.decision?.at).toBeInstanceOf(Timestamp);
  });

  it('the provider’s failure is a 502 without its words, and a budget refusal a 429', async () => {
    const fx = await createBoardFixture(ctx);
    await createNote(fx.ownerToken, fx.boardId, { title: 'fail now' });
    const res = await tidy(fx.ownerToken, fx.boardId);
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('secret-project');
    // This fake fails without usage, as a dropped connection does: the call and its retry stay
    // charged, but hold no slot once the tidy answered.
    const day = dayKey(new Date());
    const failedDay = (await assistantUsageCol(ctx.db, fx.ownerId).doc(day).get()).data();
    expect(failedDay?.inFlight).toEqual({});
    expect(failedDay?.tokens).toBeGreaterThan(0);

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
    // An undated note the model would place: the batch is full, so the model is not asked.
    await createNote(fx.ownerToken, fx.boardId, { title: 'later: no room' });
    const res = await tidy(fx.ownerToken, fx.boardId);
    expect(res.statusCode).toBe(200);
    const { moves } = res.json().tidy;
    expect(moves.map((m: { noteId: string }) => m.noteId)).toEqual(ids.slice(0, TIDY_MAX_MOVES));
    expect(calls).toBe(0);
  });

  it('lists only as many undated notes as the batch has room for, the newest first', async () => {
    const fx = await createBoardFixture(ctx);
    for (let i = 0; i < TIDY_MAX_MOVES - 1; i++) {
      const dueDate = new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);
      await createNote(fx.ownerToken, fx.boardId, { title: `dated ${i}`, dueDate });
    }
    await createNote(fx.ownerToken, fx.boardId, { title: 'later: older' });
    const newer = (await createNote(fx.ownerToken, fx.boardId, { title: 'later: newer' })).json();
    const res = await tidy(fx.ownerToken, fx.boardId);
    expect(res.statusCode).toBe(200);
    expect(calls).toBe(1);
    expect(lastInput?.prompt).toBe(`Notes in Today, newest first:\n${newer.id}: later: newer`);
    expect(lastInput?.maxOutputTokens).toBe(128 + 64);
    const { moves } = res.json().tidy;
    expect(moves).toHaveLength(TIDY_MAX_MOVES);
    expect(moves.at(-1)).toMatchObject({ noteId: newer.id, source: 'words' });
  });

  it('considers only the notes the request names: a hidden note is neither moved by date nor listed', async () => {
    const fx = await createBoardFixture(ctx);
    const shownDated = (
      await createNote(fx.ownerToken, fx.boardId, {
        title: 'Monday',
        dueDate: '2026-10-19',
        horizon: 'THIS_WEEK',
      })
    ).json();
    await createNote(fx.ownerToken, fx.boardId, {
      title: 'hidden Monday',
      dueDate: '2026-10-19',
      horizon: 'THIS_WEEK',
    });
    const shownUndated = (
      await createNote(fx.ownerToken, fx.boardId, { title: 'later: shown' })
    ).json();
    await createNote(fx.ownerToken, fx.boardId, { title: 'later: hidden' });
    const res = await tidy(fx.ownerToken, fx.boardId, [shownDated.id, shownUndated.id]);
    expect(res.statusCode).toBe(200);
    const { moves } = res.json().tidy;
    expect(moves.map((m: { noteId: string; source: string }) => [m.noteId, m.source])).toEqual([
      [shownDated.id, 'date'],
      [shownUndated.id, 'words'],
    ]);
    expect(lastInput?.prompt).toBe(
      `Notes in Today, newest first:\n${shownUndated.id}: later: shown`,
    );
  });

  it('refuses a list of notes longer than four batches', async () => {
    const fx = await createBoardFixture(ctx);
    const only = Array.from({ length: TIDY_MAX_MOVES * 4 + 1 }, (_, i) => `n${i}`);
    const res = await tidy(fx.ownerToken, fx.boardId, only);
    expect(res.statusCode).toBe(400);
  });

  it('refuses a time zone the runtime does not know', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/assistant/tidies`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { timeZone: 'Mars/Olympus_Mons', today: TODAY },
    });
    expect(res.statusCode).toBe(400);
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

  /** A dated batch of three: Monday and Tuesday in This week (both to Later), an overdue one in Later (to Today). */
  async function threeDated(fx: Awaited<ReturnType<typeof createBoardFixture>>) {
    const a = (
      await createNote(fx.ownerToken, fx.boardId, {
        title: 'Monday',
        dueDate: '2026-10-19',
        horizon: 'THIS_WEEK',
      })
    ).json();
    const b = (
      await createNote(fx.ownerToken, fx.boardId, {
        title: 'Tuesday',
        dueDate: '2026-10-20',
        horizon: 'THIS_WEEK',
      })
    ).json();
    const c = (
      await createNote(fx.ownerToken, fx.boardId, {
        title: 'Overdue',
        dueDate: '2026-10-01',
        horizon: 'LATER',
      })
    ).json();
    const dto = (await tidy(fx.ownerToken, fx.boardId)).json().tidy;
    return { a, b, c, dto };
  }
  /** Every audit row in the test project: each test starts from an empty database. */
  const audits = async (_userId: string) => (await assistantAuditCol(ctx.db).get()).size;
  const movedByAssistant = async (noteId: string) =>
    (await historyCol(ctx.db, noteId).where('type', '==', 'MOVED').get()).docs.filter(
      (snap) => (snap.data().metadata as { via?: string }).via === 'assistant',
    ).length;

  it('a keep moves every note through the command layer, once, with an audit row each', async () => {
    const fx = await createBoardFixture(ctx);
    const { a, b, c, dto } = await threeDated(fx);
    const res = await decide(fx.ownerToken, fx.boardId, dto.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tidy).toMatchObject({
      status: 'KEPT',
      // The record's order: dated moves earliest due first.
      kept: { noteIds: [c.id, a.id, b.id], skipped: [] },
    });
    expect((await note(a.id)).horizon).toBe('LATER');
    expect((await note(b.id)).horizon).toBe('LATER');
    expect((await note(c.id)).horizon).toBe('TODAY');
    expect(await movedByAssistant(a.id)).toBe(1);
    expect(await audits(fx.ownerId)).toBe(3);
    // A repeat replays the receipts: nothing moves twice, nothing is audited twice.
    const again = await decide(fx.ownerToken, fx.boardId, dto.id, {
      decision: 'keep',
      source: 'click',
    });
    expect(again.json().tidy.status).toBe('KEPT');
    expect(await audits(fx.ownerId)).toBe(3);
    expect((await note(a.id)).revision).toBe(a.revision + 1);
  });

  it('a keep of a subset moves those notes only; a note edited meanwhile is skipped', async () => {
    const fx = await createBoardFixture(ctx);
    const { a, b, c, dto } = await threeDated(fx);
    await patchTitle(fx.ownerToken, b.id, 'Tuesday, edited');
    const res = await decide(fx.ownerToken, fx.boardId, dto.id, {
      decision: 'keep',
      source: 'click',
      noteIds: [a.id, b.id],
    });
    expect(res.json().tidy.kept).toEqual({ noteIds: [a.id], skipped: [b.id] });
    expect((await note(a.id)).horizon).toBe('LATER');
    expect((await note(b.id)).horizon).toBe('THIS_WEEK');
    expect((await note(c.id)).horizon).toBe('LATER');
    expect(await audits(fx.ownerId)).toBe(1);
  });

  it('a keep of all three with the middle one edited since moves the other two; an undo moves back exactly those', async () => {
    const fx = await createBoardFixture(ctx);
    const { a, b, c, dto } = await threeDated(fx);
    // The record's order is c, a, b (earliest due first): a is the middle move.
    expect(dto.moves.map((m: { noteId: string }) => m.noteId)).toEqual([c.id, a.id, b.id]);
    await patchTitle(fx.ownerToken, a.id, 'Monday, edited');
    const edited = await note(a.id);
    const auditsOf = async (noteId: string) =>
      (await assistantAuditCol(ctx.db).where('targetId', '==', noteId).get()).size;

    const res = await decide(fx.ownerToken, fx.boardId, dto.id, {
      decision: 'keep',
      source: 'enter',
      noteIds: [c.id, a.id, b.id],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tidy).toMatchObject({
      status: 'KEPT',
      kept: { noteIds: [c.id, b.id], skipped: [a.id] },
    });
    expect((await stored(fx.ownerId, dto.id)).status).toBe('KEPT');
    expect((await note(c.id)).horizon).toBe('TODAY');
    expect((await note(b.id)).horizon).toBe('LATER');
    expect((await note(a.id)).horizon).toBe('THIS_WEEK');
    expect(await movedByAssistant(c.id)).toBe(1);
    expect(await movedByAssistant(b.id)).toBe(1);
    expect(await movedByAssistant(a.id)).toBe(0);
    const afterKeep = await audits(fx.ownerId);
    expect(afterKeep).toBeLessThanOrEqual(3);
    expect(afterKeep).toBe(2);
    expect(await auditsOf(a.id)).toBe(0);

    // A repeated keep replays: no audit row, nothing moves.
    const again = await decide(fx.ownerToken, fx.boardId, dto.id, {
      decision: 'keep',
      source: 'click',
      noteIds: [c.id, a.id, b.id],
    });
    expect(again.json().tidy.kept).toEqual({ noteIds: [c.id, b.id], skipped: [a.id] });
    expect(await audits(fx.ownerId)).toBe(afterKeep);
    expect((await note(c.id)).revision).toBe(c.revision + 1);
    expect((await note(b.id)).revision).toBe(b.revision + 1);

    const undone = await decide(fx.ownerToken, fx.boardId, dto.id, {
      decision: 'undo',
      source: 'click',
    });
    expect(undone.json().tidy.status).toBe('UNDONE');
    expect((await stored(fx.ownerId, dto.id)).status).toBe('UNDONE');
    expect((await stored(fx.ownerId, dto.id)).undone?.noteIds).toEqual([b.id, c.id]);
    expect((await note(c.id)).horizon).toBe('LATER');
    expect((await note(b.id)).horizon).toBe('THIS_WEEK');
    const untouched = await note(a.id);
    expect(untouched.horizon).toBe(edited.horizon);
    expect(untouched.revision).toBe(edited.revision);
    expect(await auditsOf(a.id)).toBe(0);
    const afterUndo = await audits(fx.ownerId);
    expect(afterUndo).toBe(afterKeep + 2);

    // A second undo replays.
    const twice = await decide(fx.ownerToken, fx.boardId, dto.id, {
      decision: 'undo',
      source: 'shortcut',
    });
    expect(twice.json().tidy.status).toBe('UNDONE');
    expect(await audits(fx.ownerId)).toBe(afterUndo);
  });

  it('an undo puts the moved notes back on the revisions the keep produced, and leaves one edited since', async () => {
    const fx = await createBoardFixture(ctx);
    const { a, b, c, dto } = await threeDated(fx);
    await decide(fx.ownerToken, fx.boardId, dto.id, { decision: 'keep', source: 'enter' });
    await patchTitle(fx.ownerToken, c.id, 'Overdue, edited after the keep');
    const res = await decide(fx.ownerToken, fx.boardId, dto.id, {
      decision: 'undo',
      source: 'click',
    });
    expect(res.json().tidy.status).toBe('UNDONE');
    expect((await note(a.id)).horizon).toBe('THIS_WEEK');
    expect((await note(b.id)).horizon).toBe('THIS_WEEK');
    expect((await note(c.id)).horizon).toBe('TODAY');
    expect(await audits(fx.ownerId)).toBe(5);
    // The record names the notes the undo moved back, in the order it moved them.
    expect((await stored(fx.ownerId, dto.id)).undone).toMatchObject({
      source: 'click',
      noteIds: [b.id, a.id],
    });
    // A second undo replays.
    expect(
      (
        await decide(fx.ownerToken, fx.boardId, dto.id, { decision: 'undo', source: 'shortcut' })
      ).json().tidy.status,
    ).toBe('UNDONE');
    expect(await audits(fx.ownerId)).toBe(5);
  });

  it('two tabs keeping at once move the notes once and both see the kept record', async () => {
    const fx = await createBoardFixture(ctx);
    const { a, dto } = await threeDated(fx);
    const [one, two] = await Promise.all([
      decide(fx.ownerToken, fx.boardId, dto.id, { decision: 'keep', source: 'enter' }),
      decide(fx.ownerToken, fx.boardId, dto.id, { decision: 'keep', source: 'click' }),
    ]);
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    expect(one.json().tidy.status).toBe('KEPT');
    expect(two.json().tidy.status).toBe('KEPT');
    expect(one.json().tidy.kept.skipped).toEqual([]);
    expect(two.json().tidy.kept).toEqual(one.json().tidy.kept);
    expect(one.json().tidy.kept.noteIds).toHaveLength(3);
    expect((await note(a.id)).revision).toBe(a.revision + 1);
    expect(await audits(fx.ownerId)).toBe(3);
  });

  it('a keep cut short after one move resumes: that move replays under its id, the rest move', async () => {
    const fx = await createBoardFixture(ctx);
    const { a, b, c, dto } = await threeDated(fx);
    const record = await stored(fx.ownerId, dto.id);
    // The first move committed under its own apply id, then the keep stopped before the record
    // was written: KEPT, every note chosen, nothing applied.
    const first = record.moves[0]!;
    expect(first.noteId).toBe(c.id);
    await runOperation(
      {
        db: ctx.db,
        actor: { id: fx.ownerId, email: 'owner@fixture.de', emailVerified: true },
        boardId: fx.boardId,
        provenance: { via: 'assistant', conversationId: dto.id, approvalId: dto.id },
      },
      {
        name: 'move_note',
        input: {
          boardId: fx.boardId,
          noteId: c.id,
          expectedRevision: first.baseRevision,
          input: { mode: 'HORIZON', horizon: first.to },
        },
        operationId: first.operationIds.apply,
      },
    );
    await assistantTidiesCol(ctx.db, fx.ownerId)
      .doc(dto.id)
      .update({
        status: 'KEPT',
        decision: { source: 'enter', noteIds: [c.id, a.id, b.id], at: Timestamp.now() },
        applied: null,
      });
    expect(await audits(fx.ownerId)).toBe(1);

    const res = await decide(fx.ownerToken, fx.boardId, dto.id, {
      decision: 'keep',
      source: 'click',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tidy).toMatchObject({
      status: 'KEPT',
      kept: { noteIds: [c.id, a.id, b.id], skipped: [] },
    });
    expect((await note(c.id)).revision).toBe(c.revision + 1);
    expect(await movedByAssistant(c.id)).toBe(1);
    expect((await note(a.id)).horizon).toBe('LATER');
    expect((await note(b.id)).horizon).toBe('LATER');
    expect(await audits(fx.ownerId)).toBe(3);
  });

  it('a discard decides the record and moves nothing; a keep after it is refused', async () => {
    const fx = await createBoardFixture(ctx);
    const { a, dto } = await threeDated(fx);
    const res = await decide(fx.ownerToken, fx.boardId, dto.id, {
      decision: 'discard',
      source: 'esc',
    });
    expect(res.json().tidy.status).toBe('DISCARDED');
    expect((await note(a.id)).horizon).toBe('THIS_WEEK');
    expect(
      (await decide(fx.ownerToken, fx.boardId, dto.id, { decision: 'keep', source: 'enter' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await decide(fx.ownerToken, fx.boardId, dto.id, { decision: 'undo', source: 'esc' }))
        .statusCode,
    ).toBe(409);
  });

  it('another member’s record is not found', async () => {
    const fx = await createBoardFixture(ctx);
    const { dto } = await threeDated(fx);
    expect(
      (await decide(fx.editToken, fx.boardId, dto.id, { decision: 'keep', source: 'enter' }))
        .statusCode,
    ).toBe(404);
  });
});
