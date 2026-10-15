import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { dayKey, nextDayStart } from '../src/lib/assistant/budget/ledger.js';
import type { TurnInput, TurnOutput, TurnRunner } from '../src/lib/assistant/model/index.js';
import {
  assistantConversationsCol,
  assistantUsageCol,
  whiteboardsCol,
} from '../src/lib/db/collections.js';
import {
  buildTestApp,
  createBoardFixture,
  registerTestUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

const PROJECT_ID = 'wally-test-assistant-turns';
const usage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 };

/** Each message is a script: the fake calls tools like a model would and answers with markers. */
const fakeRunner: TurnRunner = async (input: TurnInput): Promise<TurnOutput> => {
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
      steps: 1,
      finishReason: 'stop',
      messages: [
        ...input.history,
        { role: 'user', content: message },
        { role: 'assistant', content: text },
      ],
    };
  };
  /** `list{"boardId":…}` and `limit{"boardId":…}` carry the board id the tools must name. */
  const boardIdAfter = (prefix: string) =>
    (JSON.parse(message.slice(prefix.length) || '{}') as { boardId?: string }).boardId;
  if (message.startsWith('list')) {
    const boardId = boardIdAfter('list');
    const result = (await tool('list_notes').execute({ boardId })) as {
      notes: { id: string; title: string }[];
      truncated: boolean;
    };
    const ids = result.notes.map((n) => `[note:${n.id}]`).join(' ');
    return finish(`Offen: ${ids}${result.truncated ? ' (mehr)' : ''}`, [
      { toolCallId: 'c1', toolName: 'list_notes', input: { boardId }, output: result },
    ]);
  }
  if (message.startsWith('markers:')) return finish(message.slice('markers:'.length));
  /**
   * Thirteen calls with each thrown error kept as a tool result, as the library does: a tool
   * that throws becomes an error-text result, and the step still ends (runTurn.test.ts).
   */
  const overrun = async (boardId: string | undefined) => {
    for (let i = 0; i < 13; i++) {
      try {
        await tool('list_notes').execute({ boardId });
      } catch {
        // A tool error, reported to the model.
      }
    }
  };
  if (message.startsWith('limit-last')) {
    // The overrun falls in the last allowed step: the loop ends without another model call,
    // so nothing throws and the runner returns output.
    await overrun(boardIdAfter('limit-last'));
    return finish('Fertig.');
  }
  if (message.startsWith('limit-next')) {
    // The step ends, then the next step is announced before its model call fails on the
    // aborted signal.
    await overrun(boardIdAfter('limit-next'));
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
    return finish('Zu spät.');
  }
  if (message.startsWith('limit')) {
    const boardId = boardIdAfter('limit');
    for (let i = 0; i < 13; i++) {
      if (input.abortSignal?.aborted) throw input.abortSignal.reason;
      await tool('list_notes').execute({ boardId });
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
  return finish(`Antwort auf: ${message}`);
};

describe('assistant turns', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID, {
      assistantRunner: fakeRunner,
      assistantEnabled: true,
      assistantDeadlineMs: 500,
    });
  });
  afterEach(async () => {
    await resetDatabase(PROJECT_ID);
  });
  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });

  /** The ledger keys usage by the server's UTC day, not by the request's `today`. */
  const usageDay = () => dayKey(new Date());
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
    const note = (await createNote(fx.ownerToken, fx.boardId, 'Müller anrufen')).json();
    const res = await turn(
      fx.ownerToken,
      fx.boardId,
      `list${JSON.stringify({ boardId: fx.boardId })}`,
    );
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
      text: 'Offen: Müller anrufen',
      chips: [{ id: note.id, title: 'Müller anrufen' }],
      partial: false,
      stopped: null,
    });
    const usageDoc = (await assistantUsageCol(ctx.db, fx.ownerId).doc(usageDay()).get()).data();
    expect(usageDoc?.tokens).toBe(120);
    expect(usageDoc?.inFlight).toEqual({});
  });

  it("uses the real date and zone from the request and the caller's language", async () => {
    const fx = await createBoardFixture(ctx);
    const res = await turn(fx.viewToken, fx.boardId, 'echo-instructions');
    expect(res.statusCode).toBe(200);
    const text = res.json().conversation.entries[1].text as string;
    expect(text).toContain('2026-10-15');
    expect(text).toContain('Europe/Berlin');
    expect(text).toContain('VIEW');
  });

  it('drops chips for notes the caller cannot see', async () => {
    const fx = await createBoardFixture(ctx);
    const shared = (await createNote(fx.ownerToken, fx.boardId, 'Sichtbar')).json();
    const secret = (
      await createNote(fx.ownerToken, fx.boardId, 'Geheim', { visibility: 'PRIVATE' })
    ).json();
    const res = await turn(
      fx.editToken,
      fx.boardId,
      `markers:Siehe [note:${secret.id}] und [note:${shared.id}].`,
    );
    expect(res.json().conversation.entries[1]).toMatchObject({
      text: 'Siehe und Sichtbar.',
      chips: [{ id: shared.id, title: 'Sichtbar' }],
    });
  });

  it('continues a conversation and starts a new one when none is given', async () => {
    const fx = await createBoardFixture(ctx);
    const first = (await turn(fx.ownerToken, fx.boardId, 'eins')).json().conversation;
    const second = (await turn(fx.ownerToken, fx.boardId, 'zwei', first.id)).json().conversation;
    expect(second.id).toBe(first.id);
    expect(second.entries).toHaveLength(4);
    const third = (await turn(fx.ownerToken, fx.boardId, 'drei')).json().conversation;
    expect(third.id).not.toBe(first.id);
    const latest = await ctx.inject({
      method: 'GET',
      url: `/whiteboards/${fx.boardId}/assistant/conversations/latest`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(latest.json().id).toBe(third.id);
    const byId = await ctx.inject({
      method: 'GET',
      url: `/whiteboards/${fx.boardId}/assistant/conversations/${first.id}`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(byId.json().entries).toHaveLength(4);
    const foreign = await ctx.inject({
      method: 'GET',
      url: `/whiteboards/${fx.boardId}/assistant/conversations/${first.id}`,
      headers: ctx.authHeader(fx.editToken),
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('stops at the tool-call limit and says so, keeping the conversation', async () => {
    const fx = await createBoardFixture(ctx);
    const first = (await turn(fx.ownerToken, fx.boardId, 'eins')).json().conversation;
    const res = await turn(
      fx.ownerToken,
      fx.boardId,
      `limit${JSON.stringify({ boardId: fx.boardId })}`,
      first.id,
    );
    expect(res.statusCode).toBe(200);
    const c = res.json().conversation;
    expect(c.entries).toHaveLength(4);
    expect(c.entries[3]).toMatchObject({ role: 'assistant', text: '', stopped: 'TOOL_LIMIT' });
    const stored = (await assistantConversationsCol(ctx.db, fx.ownerId).doc(first.id).get()).data();
    expect(stored?.messages).toHaveLength(2);
    expect(stored?.toolCalls).toBe(12);
  });

  it('stops at the tool-call limit even when the runner still returns output', async () => {
    const fx = await createBoardFixture(ctx);
    const first = (await turn(fx.ownerToken, fx.boardId, 'eins')).json().conversation;
    const res = await turn(
      fx.ownerToken,
      fx.boardId,
      `limit-last${JSON.stringify({ boardId: fx.boardId })}`,
      first.id,
    );
    expect(res.statusCode).toBe(200);
    const c = res.json().conversation;
    expect(c.entries[3]).toMatchObject({
      role: 'assistant',
      text: '',
      chips: [],
      stopped: 'TOOL_LIMIT',
    });
    const stored = (await assistantConversationsCol(ctx.db, fx.ownerId).doc(first.id).get()).data();
    expect(stored?.messages).toHaveLength(2);
    expect(stored?.toolCalls).toBe(12);
  });

  it('reserves nothing for a step announced after the turn stopped', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await turn(
      fx.ownerToken,
      fx.boardId,
      `limit-next${JSON.stringify({ boardId: fx.boardId })}`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().conversation.entries[1]).toMatchObject({ text: '', stopped: 'TOOL_LIMIT' });
    const usageDoc = (await assistantUsageCol(ctx.db, fx.ownerId).doc(usageDay()).get()).data();
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

  it('refuses a cap with a code and the reset time, and makes no call', async () => {
    const fx = await createBoardFixture(ctx);
    const day = usageDay();
    await assistantUsageCol(ctx.db, fx.ownerId)
      .doc(day)
      .set({ tokens: 300_000, inFlight: {}, updatedAt: Timestamp.now() });
    const res = await turn(fx.ownerToken, fx.boardId, 'eins');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({
      error: 'ASSISTANT_DAILY_CAP',
      resetsAt: nextDayStart(day).toISOString(),
    });
    expect((await assistantConversationsCol(ctx.db, fx.ownerId).get()).size).toBe(0);
  });

  it('answers 409 on a conversation pinned to another model, and 404 off, for outsiders, and on a closed one', async () => {
    const fx = await createBoardFixture(ctx);
    const first = (await turn(fx.ownerToken, fx.boardId, 'eins')).json().conversation;
    await assistantConversationsCol(ctx.db, fx.ownerId)
      .doc(first.id)
      .update({ model: 'vertex:old-model' });
    expect((await turn(fx.ownerToken, fx.boardId, 'zwei', first.id)).statusCode).toBe(409);
    expect((await turn(fx.ownerToken, fx.boardId, 'zwei', first.id)).json().error).toBe(
      'ASSISTANT_CONVERSATION_CLOSED',
    );
    await assistantConversationsCol(ctx.db, fx.ownerId)
      .doc(first.id)
      .update({ model: 'vertex:gemini-3.8-flash', status: 'CLOSED' });
    expect((await turn(fx.ownerToken, fx.boardId, 'zwei', first.id)).statusCode).toBe(409);
    expect((await turn(fx.outsiderToken, fx.boardId, 'eins')).statusCode).toBe(404);
    await whiteboardsCol(ctx.db).doc(fx.boardId).update({ assistantDisabled: true });
    expect((await turn(fx.ownerToken, fx.boardId, 'eins')).statusCode).toBe(404);
    expect(
      (
        await ctx.inject({
          method: 'GET',
          url: `/whiteboards/${fx.boardId}/assistant/conversations/latest`,
          headers: ctx.authHeader(fx.ownerToken),
        })
      ).statusCode,
    ).toBe(404);
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

  it('answers the route rate limit with the app envelope, without a reset time', async () => {
    const fx = await createBoardFixture(ctx);
    // A caller of its own, so the other tests' turns do not count against this budget.
    const token = registerTestUser(ctx, 'rl-assistant', 'rl-assistant@fixture.de');
    let res = await turn(token, fx.boardId, 'eins');
    for (let i = 0; i < 30 && res.statusCode !== 429; i++)
      res = await turn(token, fx.boardId, 'eins');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'RATE_LIMITED', message: expect.any(String) });
    expect(res.json().resetsAt).toBeUndefined();
  });
});
