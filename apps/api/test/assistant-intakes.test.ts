import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type {
  IntakeInput,
  IntakeOutput,
  IntakeRunner,
  ModelIntakeItem,
} from '../src/lib/assistant/model/index.js';
import { assistantUsage } from '../src/lib/postgres/schema/index.js';
import { dayKey } from '../src/lib/assistant/budget/ledger.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const usage = { inputTokens: 50, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 };
let lastInput: IntakeInput | null = null;

const blank = { text: '', noteId: '', question: '', options: [] };
/** The listed notes, read back out of the prompt as the model would see them. */
const listed = (prompt: string) =>
  prompt
    .split('\n')
    .slice(prompt.split('\n').findIndex((l) => l.startsWith('Open notes')) + 1)
    .map((line) => {
      const [id, ...title] = line.split(': ');
      return { id: id!, title: title.join(': ') };
    });

/**
 * Answers by the message's first word: "two" gives two notes, "what" an ask, "dupe" a duplicate
 * of the first listed note, "fail" the provider's error; anything else is one note.
 */
const fakeRunner: IntakeRunner = async (input): Promise<IntakeOutput> => {
  lastInput = input;
  const lease = await input.onAttempt({
    stepNumber: 0,
    messageCount: 1,
    maxOutputTokens: input.maxOutputTokens,
  });
  const message = input.prompt.split('\n')[1]!;
  if (message.startsWith('fail'))
    throw Object.assign(new Error('quota for secret-project'), {
      name: 'AI_APICallError',
      statusCode: 429,
    });
  let items: ModelIntakeItem[];
  if (message.startsWith('two'))
    items = [
      { ...blank, kind: 'note', text: 'Dentist Thursday' },
      { ...blank, kind: 'note', text: 'Ask Tom about the budget' },
    ];
  else if (message.startsWith('what')) items = [{ ...blank, kind: 'ask', text: message }];
  else if (message.startsWith('dupe'))
    items = [
      { ...blank, kind: 'duplicate', text: message, noteId: listed(input.prompt)[0]?.id ?? '' },
    ];
  else items = [{ ...blank, kind: 'note', text: message }];
  await lease.settle(usage);
  return { items, usage, finishReason: 'stop' };
};

describe('intakes', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp({ intakeRunner: fakeRunner, assistantEnabled: true });
  });
  afterEach(async () => {
    lastInput = null;
    await resetDatabase(ctx.db);
  });
  afterAll(async () => {
    await resetDatabase(ctx.db);
    await ctx.app.close();
  });

  const intake = (token: string, boardId: string, body: Record<string, unknown>) =>
    ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/assistant/intakes`,
      headers: ctx.authHeader(token),
      payload: { timeZone: 'Europe/Berlin', today: '2026-11-08', ...body },
    });
  const createNote = (token: string, boardId: string, body: Record<string, unknown>) =>
    ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/notes`,
      headers: ctx.authHeader(token),
      payload: body,
    });

  it('answers notes for a note message', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await intake(fx.ownerToken, fx.boardId, { message: 'two things' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        { kind: 'note', text: 'Dentist Thursday' },
        { kind: 'note', text: 'Ask Tom about the budget' },
      ],
      truncated: false,
    });
  });

  it('answers ask', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await intake(fx.ownerToken, fx.boardId, { message: 'what is blocking munich' });
    expect(res.json().items).toEqual([{ kind: 'ask', text: 'what is blocking munich' }]);
  });

  it("answers duplicate with the matching note's title", async () => {
    const fx = await createBoardFixture(ctx);
    const note = (
      await createNote(fx.ownerToken, fx.boardId, { title: 'Update premium table' })
    ).json();
    const res = await intake(fx.ownerToken, fx.boardId, { message: 'dupe the table' });
    expect(res.json().items).toEqual([
      {
        kind: 'duplicate',
        text: 'dupe the table',
        note: { id: note.id, title: 'Update premium table' },
      },
    ]);
  });

  it('404 when the board’s assistant is off', async () => {
    const fx = await createBoardFixture(ctx);
    await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}/assistant`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { enabled: false },
    });
    expect((await intake(fx.ownerToken, fx.boardId, { message: 'hello' })).statusCode).toBe(404);
  });

  it('404 for a non-member', async () => {
    const fx = await createBoardFixture(ctx);
    expect((await intake(fx.outsiderToken, fx.boardId, { message: 'hello' })).statusCode).toBe(404);
  });

  it('the prompt never lists a private note of someone else', async () => {
    const fx = await createBoardFixture(ctx);
    await createNote(fx.ownerToken, fx.boardId, { title: 'Owner secret', visibility: 'PRIVATE' });
    await createNote(fx.ownerToken, fx.boardId, { title: 'Shared plan' });
    await intake(fx.editToken, fx.boardId, { message: 'hello' });
    expect(lastInput?.prompt).toContain('Shared plan');
    expect(lastInput?.prompt).not.toContain('Owner secret');
  });

  it('a provider error is 502 without its wording', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await intake(fx.ownerToken, fx.boardId, { message: 'fail now' });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('secret-project');
  });

  it('charges the ledger once per call', async () => {
    const fx = await createBoardFixture(ctx);
    await intake(fx.ownerToken, fx.boardId, { message: 'hello' });
    const row = (
      await ctx.db
        .select()
        .from(assistantUsage)
        .where(
          and(eq(assistantUsage.userId, fx.ownerId), eq(assistantUsage.day, dayKey(new Date()))),
        )
    )[0];
    expect(row?.tokens).toBe(usage.inputTokens + usage.outputTokens);
  });

  it('sends context only when given', async () => {
    const fx = await createBoardFixture(ctx);
    await intake(fx.ownerToken, fx.boardId, { message: 'and next week?' });
    expect(lastInput?.prompt).not.toContain('Showing in the box');
    await intake(fx.ownerToken, fx.boardId, {
      message: 'and next week?',
      context: { question: 'What is due?', answer: 'The renewal call.' },
    });
    expect(lastInput?.prompt).toContain('Question: What is due?');
  });
});
