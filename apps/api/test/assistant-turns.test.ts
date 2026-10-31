import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { CHARS_PER_TOKEN } from '../src/lib/assistant/budget/estimate.js';
import { dayKey, nextDayStart } from '../src/lib/assistant/budget/ledger.js';
import type {
  TurnInput,
  TurnOutput,
  TurnRunner,
  TurnTool,
} from '../src/lib/assistant/model/index.js';
import {
  assistantAttempts,
  assistantConversations,
  assistantUsage,
  whiteboards,
} from '../src/lib/postgres/schema/index.js';
import {
  buildTestApp,
  createBoardFixture,
  registerTestUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

const usage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 };

/** The tools the last turn offered the model. */
let offered: TurnTool[] = [];

/** Each message is a script: the fake calls tools like a model would and answers with markers. */
const fakeRunner: TurnRunner = async (input: TurnInput): Promise<TurnOutput> => {
  offered = input.tools;
  const lease = await input.onAttempt({
    stepNumber: 0,
    messageCount: input.history.length + 1,
    maxOutputTokens: input.maxOutputTokens,
  });
  const tool = (name: string) => input.tools.find((t) => t.name === name)!;
  const message = input.userMessage ?? '';
  const finish = async (
    text: string,
    toolCalls: TurnOutput['toolCalls'] = [],
  ): Promise<TurnOutput> => {
    await lease.settle(usage);
    return {
      text,
      pendingApprovals: [],
      toolCalls,
      usage,
      unsettledSteps: 0,
      steps: 1,
      finishReason: 'stop',
      messages: [
        ...input.history,
        { role: 'user', content: message },
        { role: 'assistant', content: text },
      ],
    };
  };
  // The tools never take a board id: the server binds the conversation's board.
  if (message === 'list') {
    const result = (await tool('list_notes').execute({})) as {
      notes: { id: string; title: string }[];
      truncated: boolean;
    };
    const ids = result.notes.map((n) => `[note:${n.id}]`).join(' ');
    return finish(`Open: ${ids}${result.truncated ? ' (more)' : ''}`, [
      { toolCallId: 'c1', toolName: 'list_notes', input: {}, output: result },
    ]);
  }
  if (message === 'thinking') {
    // The providers count thinking inside outputTokens; reasoningTokens is a part of it.
    await lease.settle({ ...usage, reasoningTokens: 15 });
    return finish('Thought.');
  }
  if (message === 'grow') {
    // A second step after a read: it sends the read's result, so it reserves more.
    const result = await tool('list_notes').execute({});
    await lease.settle(usage);
    const next = await input.onAttempt({
      stepNumber: 1,
      messageCount: input.history.length + 3,
      maxOutputTokens: input.maxOutputTokens,
    });
    await next.settle(usage);
    return finish(`chars:${JSON.stringify(result).length}`);
  }
  if (message === 'provider-error')
    throw new Error('Vertex said: quota exceeded for project secret-project-42');
  if (message === 'provider-400')
    // What the library throws with retries off: the provider's status and wording.
    throw Object.assign(new Error('Invalid JSON payload for secret-project-42'), {
      name: 'AI_APICallError',
      statusCode: 400,
    });
  if (message === 'provider-no-read')
    // What the runner throws when a question's first step answers without reading the board
    // (runTurn.ts forces a tool call there): the model's own reply is in the error.
    throw Object.assign(
      new Error('Model response did not contain a tool call even though tool choice was required.'),
      {
        name: 'AI_ToolChoiceViolationError',
        content: [{ type: 'text', text: 'This panel answers questions about the board.' }],
      },
    );
  if (message.startsWith('get:')) {
    try {
      const note = (await tool('get_note').execute({ noteId: message.slice('get:'.length) })) as {
        id: string;
      };
      return finish(`[note:${note.id}]`);
    } catch (error) {
      return finish(`error:${(error as { code?: string }).code}`);
    }
  }
  if (message.startsWith('markers:')) return finish(message.slice('markers:'.length));
  if (message.startsWith('titles:')) {
    // The titles exactly as the read tools hand them to the model.
    const list = (await tool('list_notes').execute({})) as { notes: { title: string }[] };
    const note = (await tool('get_note').execute({ noteId: message.slice('titles:'.length) })) as {
      title: string;
    };
    return finish(`${list.notes.map((n) => n.title).join('|')}/${note.title}`);
  }
  /**
   * Thirteen calls with each thrown error kept as a tool result, as the library does: a tool
   * that throws becomes an error-text result, and the step still ends (runTurn.test.ts).
   */
  const overrun = async () => {
    for (let i = 0; i < 13; i++) {
      try {
        await tool('list_notes').execute({});
      } catch {
        // A tool error, reported to the model.
      }
    }
  };
  if (message === 'limit-last') {
    // The overrun falls in the last allowed step: the loop ends without another model call,
    // so nothing throws and the runner returns output.
    await overrun();
    return finish('Done.');
  }
  if (message === 'limit-next') {
    // The step ends, then the next step is announced before its model call fails on the
    // aborted signal.
    await overrun();
    await lease.settle(usage);
    await input.onAttempt({
      stepNumber: 1,
      messageCount: input.history.length + 3,
      maxOutputTokens: input.maxOutputTokens,
    });
    if (input.abortSignal?.aborted) throw input.abortSignal.reason;
    return finish('never');
  }
  if (message === 'slow-last') {
    // The deadline fires while the last step's tool runs; the tool still returns.
    await new Promise<void>((resolve) =>
      input.abortSignal?.addEventListener('abort', () => resolve(), { once: true }),
    );
    return finish('Too late.');
  }
  if (message === 'limit') {
    for (let i = 0; i < 13; i++) {
      if (input.abortSignal?.aborted) throw input.abortSignal.reason;
      await tool('list_notes').execute({});
    }
    return finish('never');
  }
  if (message === 'hang') {
    await new Promise<never>((_, reject) =>
      input.abortSignal?.addEventListener('abort', () => reject(input.abortSignal!.reason), {
        once: true,
      }),
    );
  }
  if (message === 'echo-instructions') return finish(input.instructions);
  return finish(`Answer to: ${message}`);
};

describe('assistant turns', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp({
      assistantRunner: fakeRunner,
      assistantEnabled: true,
      assistantDeadlineMs: 500,
    });
  });
  afterEach(async () => {
    await resetDatabase(ctx.db);
  });
  afterAll(async () => {
    await resetDatabase(ctx.db);
    await ctx.app.close();
  });

  /** The ledger keys usage by the server's UTC day, not by the request's `today`. */
  const usageDay = () => dayKey(new Date());
  const usageOf = async (userId: string, day: string) =>
    (
      await ctx.db
        .select()
        .from(assistantUsage)
        .where(and(eq(assistantUsage.userId, userId), eq(assistantUsage.day, day)))
    )[0];
  const attemptsOf = (userId: string) =>
    ctx.db.select().from(assistantAttempts).where(eq(assistantAttempts.userId, userId));
  const conversationOf = async (id: string) =>
    (
      await ctx.db.select().from(assistantConversations).where(eq(assistantConversations.id, id))
    )[0];
  const conversationsOf = (userId: string) =>
    ctx.db.select().from(assistantConversations).where(eq(assistantConversations.userId, userId));
  const body = (message: string, conversationId?: string) => ({
    message,
    timeZone: 'Europe/Berlin',
    today: '2026-10-15',
    ...(conversationId ? { conversationId } : {}),
  });
  const turn = (token: string, boardId: string, message: string, conversationId?: string) =>
    ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/assistant/turns`,
      headers: ctx.authHeader(token),
      payload: body(message, conversationId),
    });
  const createNote = (
    token: string,
    boardId: string,
    title: string,
    extra: Record<string, unknown> = {},
  ) =>
    ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/notes`,
      headers: ctx.authHeader(token),
      payload: { title, ...extra },
    });

  it('answers from the live board and lists the notes it relied on', async () => {
    const fx = await createBoardFixture(ctx);
    const note = (await createNote(fx.ownerToken, fx.boardId, 'Call Müller')).json();
    const res = await turn(fx.ownerToken, fx.boardId, 'list');
    expect(res.statusCode).toBe(200);
    const { conversation } = res.json();
    expect(conversation.status).toBe('OPEN');
    expect(conversation.entries).toHaveLength(2);
    expect(conversation.entries[0]).toMatchObject({
      role: 'user',
      text: expect.stringContaining('list'),
    });
    expect(conversation.entries[1]).toMatchObject({
      role: 'assistant',
      text: 'Open: Call Müller',
      chips: [{ id: note.id, title: 'Call Müller' }],
      partial: false,
      stopped: null,
    });
    const usageDoc = await usageOf(fx.ownerId, usageDay());
    expect(usageDoc?.tokens).toBe(120);
    expect(usageDoc?.inFlight).toEqual({});
  });

  it('offers the model read tools that never ask for a board id', async () => {
    const fx = await createBoardFixture(ctx);
    expect((await turn(fx.ownerToken, fx.boardId, 'one')).statusCode).toBe(200);
    expect(offered.map((t) => t.name).sort()).toEqual(['get_note', 'list_members', 'list_notes']);
    for (const t of offered) {
      const schema = t.inputSchema as z.AnyZodObject;
      expect(Object.keys(schema.shape)).not.toContain('boardId');
      // Strict: a model that names a board anyway is refused before anything runs.
      expect(schema.safeParse({ boardId: fx.boardId }).success).toBe(false);
    }
  });

  it('binds every read to the conversation board, so a note from another board is not found', async () => {
    const fx = await createBoardFixture(ctx);
    // The editor owns a board of their own; its note is visible to them there, not here.
    const elsewhere = (await createNote(fx.editToken, fx.editorId, 'Other board')).json();
    const here = (await createNote(fx.ownerToken, fx.boardId, 'Here')).json();
    const foreign = await turn(fx.editToken, fx.boardId, `get:${elsewhere.id}`);
    expect(foreign.json().conversation.entries[1]).toMatchObject({
      text: 'error:NOT_FOUND',
      chips: [],
    });
    const own = await turn(fx.editToken, fx.boardId, `get:${here.id}`);
    expect(own.json().conversation.entries[1]).toMatchObject({
      text: 'Here',
      chips: [{ id: here.id, title: 'Here' }],
    });
  });

  it('settles output tokens once, reasoning included, as the providers report them', async () => {
    const fx = await createBoardFixture(ctx);
    expect((await turn(fx.ownerToken, fx.boardId, 'thinking')).statusCode).toBe(200);
    const usageDoc = await usageOf(fx.ownerId, usageDay());
    expect(usageDoc?.tokens).toBe(120);
  });

  it('reserves each later step with the tool results gathered so far this turn', async () => {
    const fx = await createBoardFixture(ctx);
    for (let i = 0; i < 10; i++)
      await createNote(fx.ownerToken, fx.boardId, `${i} ${'Long title '.repeat(12)}`);
    const res = await turn(fx.ownerToken, fx.boardId, 'grow');
    expect(res.statusCode).toBe(200);
    const resultChars = Number(
      (res.json().conversation.entries[1].text as string).slice('chars:'.length),
    );
    expect(resultChars).toBeGreaterThan(1000);
    const reserved = (await attemptsOf(fx.ownerId))
      .map((attempt) => attempt.reservedTokens)
      .sort((a, b) => a - b);
    expect(reserved).toHaveLength(2);
    expect(reserved[1]! - reserved[0]!).toBeGreaterThanOrEqual(
      Math.ceil(resultChars / CHARS_PER_TOKEN),
    );
  });

  it('answers a provider failure with its own error and none of the provider text', async () => {
    const fx = await createBoardFixture(ctx);
    // The owner's turns in this file come near the route's rate limit; the editor asks the last.
    for (const [token, script] of [
      [fx.ownerToken, 'provider-error'],
      [fx.ownerToken, 'provider-400'],
      [fx.editToken, 'provider-no-read'],
    ] as const) {
      const res = await turn(token, fx.boardId, script);
      expect(res.statusCode, script).toBe(502);
      expect(res.json()).toEqual({
        error: 'ASSISTANT_PROVIDER_ERROR',
        message: 'The model provider failed',
        retryable: true,
      });
      expect(res.body).not.toContain('secret-project-42');
      // A reply given without reading the board is never shown as the answer.
      expect(res.body).not.toContain('This panel answers questions about the board.');
    }
  });

  it('drops a stored chip once its note is out of sight, keeping the text', async () => {
    const fx = await createBoardFixture(ctx);
    const note = (await createNote(fx.ownerToken, fx.boardId, 'Soon private')).json();
    const first = (await turn(fx.editToken, fx.boardId, `markers:See [note:${note.id}].`)).json()
      .conversation;
    expect(first.entries[1].chips).toEqual([{ id: note.id, title: 'Soon private' }]);
    const patch = await ctx.inject({
      method: 'PATCH',
      url: `/notes/${note.id}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { visibility: 'PRIVATE' },
    });
    expect(patch.statusCode).toBe(200);
    // The next turn hands back the whole conversation, the stored entry included.
    const next = await turn(fx.editToken, fx.boardId, 'again', first.id);
    expect(next.statusCode).toBe(200);
    expect(next.json().conversation.entries[1]).toMatchObject({
      text: 'See Soon private.',
      chips: [],
    });
    // The owner still sees the note, and so the chip.
    const owner = await turn(fx.ownerToken, fx.boardId, `markers:[note:${note.id}]`);
    expect(owner.json().conversation.entries[1].chips).toEqual([
      { id: note.id, title: 'Soon private' },
    ]);
  });

  it("uses the real date and zone from the request and the caller's language", async () => {
    const fx = await createBoardFixture(ctx);
    const res = await turn(fx.viewToken, fx.boardId, 'echo-instructions');
    expect(res.statusCode).toBe(200);
    const text = res.json().conversation.entries[1].text as string;
    expect(text).toContain('2026-10-15');
    expect(text).toContain('Europe/Berlin');
    expect(text).toContain('VIEW');
    // The fixture users carry DEFAULT_LANGUAGE, which is 'de'; the reply keeps it whatever
    // language the question is in.
    expect(text).toMatch(
      /Answer in German even when the question or the notes are in another language\.$/,
    );
    const patch = await ctx.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(fx.viewToken),
      payload: { language: 'en' },
    });
    expect(patch.statusCode).toBe(200);
    const en = await turn(fx.viewToken, fx.boardId, 'echo-instructions');
    expect(en.json().conversation.entries[1].text).toMatch(
      /Answer in English even when the question or the notes are in another language\.$/,
    );
  });

  it('drops chips for notes the caller cannot see', async () => {
    const fx = await createBoardFixture(ctx);
    const shared = (await createNote(fx.ownerToken, fx.boardId, 'Visible')).json();
    const secret = (
      await createNote(fx.ownerToken, fx.boardId, 'Secret', { visibility: 'PRIVATE' })
    ).json();
    const res = await turn(
      fx.editToken,
      fx.boardId,
      `markers:See [note:${secret.id}] and [note:${shared.id}].`,
    );
    expect(res.json().conversation.entries[1]).toMatchObject({
      text: 'See and Visible.',
      chips: [{ id: shared.id, title: 'Visible' }],
    });
  });

  it("presents an untitled note under the untitled label in the caller's language, leaving it stored as is", async () => {
    const fx = await createBoardFixture(ctx);
    const note = (await createNote(fx.ownerToken, fx.boardId, '')).json();
    expect(note.title).toBe('');
    // The fixture users carry DEFAULT_LANGUAGE, which is 'de'.
    const de = await turn(fx.ownerToken, fx.boardId, `titles:${note.id}`);
    expect(de.json().conversation.entries[1].text).toBe('Ohne Titel/Ohne Titel');
    const deMarkers = await turn(fx.ownerToken, fx.boardId, `markers:Offen: [note:${note.id}].`);
    expect(deMarkers.json().conversation.entries[1]).toMatchObject({
      text: 'Offen: Ohne Titel.',
      chips: [{ id: note.id, title: 'Ohne Titel' }],
    });
    // An editor who switched to English reads the English label.
    const patch = await ctx.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(fx.editToken),
      payload: { language: 'en' },
    });
    expect(patch.statusCode).toBe(200);
    const en = await turn(fx.editToken, fx.boardId, `titles:${note.id}`);
    expect(en.json().conversation.entries[1].text).toBe('Untitled/Untitled');
    const enMarkers = await turn(fx.editToken, fx.boardId, `markers:Open: [note:${note.id}].`);
    expect(enMarkers.json().conversation.entries[1]).toMatchObject({
      text: 'Open: Untitled.',
      chips: [{ id: note.id, title: 'Untitled' }],
    });
    const stored = await ctx.inject({
      method: 'GET',
      url: `/notes/${note.id}`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(stored.json().title).toBe('');
  });

  it('continues a conversation and starts a new one when none is given', async () => {
    const fx = await createBoardFixture(ctx);
    const first = (await turn(fx.ownerToken, fx.boardId, 'one')).json().conversation;
    const second = (await turn(fx.ownerToken, fx.boardId, 'two', first.id)).json().conversation;
    expect(second.id).toBe(first.id);
    expect(second.entries).toHaveLength(4);
    const third = (await turn(fx.ownerToken, fx.boardId, 'three')).json().conversation;
    expect(third.id).not.toBe(first.id);
    // Another member cannot continue it: it is found only by its owner.
    const foreign = await turn(fx.editToken, fx.boardId, 'four', first.id);
    expect(foreign.statusCode).toBe(404);
  });

  it('stops at the tool-call limit and says so, keeping the conversation', async () => {
    const fx = await createBoardFixture(ctx);
    const first = (await turn(fx.ownerToken, fx.boardId, 'one')).json().conversation;
    const res = await turn(fx.ownerToken, fx.boardId, 'limit', first.id);
    expect(res.statusCode).toBe(200);
    const c = res.json().conversation;
    expect(c.entries).toHaveLength(4);
    expect(c.entries[3]).toMatchObject({ role: 'assistant', text: '', stopped: 'TOOL_LIMIT' });
    const stored = await conversationOf(first.id);
    expect(stored?.messages).toHaveLength(2);
    expect(stored?.toolCalls).toBe(12);
  });

  it('stops at the tool-call limit even when the runner still returns output', async () => {
    const fx = await createBoardFixture(ctx);
    const first = (await turn(fx.ownerToken, fx.boardId, 'one')).json().conversation;
    const res = await turn(fx.ownerToken, fx.boardId, 'limit-last', first.id);
    expect(res.statusCode).toBe(200);
    const c = res.json().conversation;
    expect(c.entries[3]).toMatchObject({
      role: 'assistant',
      text: '',
      chips: [],
      stopped: 'TOOL_LIMIT',
    });
    const stored = await conversationOf(first.id);
    expect(stored?.messages).toHaveLength(2);
    expect(stored?.toolCalls).toBe(12);
  });

  it('reserves nothing for a step announced after the turn stopped', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await turn(fx.ownerToken, fx.boardId, 'limit-next');
    expect(res.statusCode).toBe(200);
    expect(res.json().conversation.entries[1]).toMatchObject({ text: '', stopped: 'TOOL_LIMIT' });
    const usageDoc = await usageOf(fx.ownerId, usageDay());
    expect(usageDoc?.tokens).toBe(120);
    expect(usageDoc?.inFlight).toEqual({});
  });

  it('stops at the deadline even when the last step still returns', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await turn(fx.ownerToken, fx.boardId, 'slow-last');
    expect(res.statusCode).toBe(200);
    expect(res.json().conversation.entries[1]).toMatchObject({ text: '', stopped: 'TIMEOUT' });
  });

  it('stops at the deadline and says so', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await turn(fx.ownerToken, fx.boardId, 'hang');
    expect(res.statusCode).toBe(200);
    expect(res.json().conversation.entries[1]).toMatchObject({ text: '', stopped: 'TIMEOUT' });
  });

  it('frees the slot of a turn that failed or ran past the deadline, and keeps its charge', async () => {
    const fx = await createBoardFixture(ctx);
    expect((await turn(fx.ownerToken, fx.boardId, 'provider-error')).statusCode).toBe(502);
    expect((await turn(fx.ownerToken, fx.boardId, 'hang')).statusCode).toBe(200);
    const usageDoc = await usageOf(fx.ownerId, usageDay());
    expect(usageDoc?.inFlight).toEqual({});
    const attempts = await attemptsOf(fx.ownerId);
    expect(attempts.map((a) => a.state)).toEqual(['ABANDONED', 'ABANDONED']);
    expect(usageDoc?.tokens).toBe(attempts.reduce((sum, a) => sum + a.reservedTokens, 0));
    // Both slots are free again: the next question is answered, not refused as busy.
    expect((await turn(fx.ownerToken, fx.boardId, 'hello')).statusCode).toBe(200);
  });

  it('refuses a cap with a code and the reset time, and makes no call', async () => {
    const fx = await createBoardFixture(ctx);
    const day = usageDay();
    await ctx.db
      .insert(assistantUsage)
      .values({ userId: fx.ownerId, day, tokens: 300_000, inFlight: {}, updatedAt: new Date() });
    const res = await turn(fx.ownerToken, fx.boardId, 'one');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({
      error: 'ASSISTANT_DAILY_CAP',
      resetsAt: nextDayStart(day).toISOString(),
    });
    expect((await conversationsOf(fx.ownerId)).length).toBe(0);
  });

  it('answers 409 on a conversation pinned to another model, and 404 off, for outsiders, and on a closed one', async () => {
    const fx = await createBoardFixture(ctx);
    const first = (await turn(fx.ownerToken, fx.boardId, 'one')).json().conversation;
    await ctx.db
      .update(assistantConversations)
      .set({ model: 'vertex:old-model' })
      .where(eq(assistantConversations.id, first.id));
    expect((await turn(fx.ownerToken, fx.boardId, 'two', first.id)).statusCode).toBe(409);
    expect((await turn(fx.ownerToken, fx.boardId, 'two', first.id)).json().error).toBe(
      'ASSISTANT_CONVERSATION_CLOSED',
    );
    await ctx.db
      .update(assistantConversations)
      .set({ model: 'vertex:gemini-3.8-flash', status: 'CLOSED' })
      .where(eq(assistantConversations.id, first.id));
    expect((await turn(fx.ownerToken, fx.boardId, 'two', first.id)).statusCode).toBe(409);
    expect((await turn(fx.outsiderToken, fx.boardId, 'one')).statusCode).toBe(404);
    await ctx.db
      .update(whiteboards)
      .set({ assistantDisabled: true })
      .where(eq(whiteboards.id, fx.boardId));
    expect((await turn(fx.ownerToken, fx.boardId, 'one')).statusCode).toBe(404);
  });

  it('rejects a bad body', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/assistant/turns`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown time zone and a malformed conversation id with 400, not 500', async () => {
    const fx = await createBoardFixture(ctx);
    const post = (payload: Record<string, unknown>) =>
      ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/assistant/turns`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { ...body('one'), ...payload },
      });
    const zone = await post({ timeZone: 'Mars/Olympus_Mons' });
    expect(zone.statusCode).toBe(400);
    expect(zone.json().error).toBe('BAD_REQUEST');
    for (const conversationId of ['a/b', 'x'.repeat(129), 'with space']) {
      const id = await post({ conversationId });
      expect(id.statusCode, conversationId).toBe(400);
      expect(id.json().error, conversationId).toBe('BAD_REQUEST');
    }
    expect((await conversationsOf(fx.ownerId)).length).toBe(0);
  });

  it('answers the route rate limit with the app envelope, without a reset time', async () => {
    const fx = await createBoardFixture(ctx);
    // A caller of its own, so the other tests' turns do not count against this budget.
    const token = registerTestUser(ctx, 'rl-assistant', 'rl-assistant@fixture.de');
    let res = await turn(token, fx.boardId, 'one');
    for (let i = 0; i < 30 && res.statusCode !== 429; i++)
      res = await turn(token, fx.boardId, 'one');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'RATE_LIMITED', message: expect.any(String) });
    expect(res.json().resetsAt).toBeUndefined();
  });
});
