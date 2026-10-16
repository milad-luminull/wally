import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
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
  assistantAttemptsCol,
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
    return finish(`Offen: ${ids}${result.truncated ? ' (mehr)' : ''}`, [
      { toolCallId: 'c1', toolName: 'list_notes', input: {}, output: result },
    ]);
  }
  if (message === 'thinking') {
    // The providers count thinking inside outputTokens; reasoningTokens is a part of it.
    await lease.settle({ ...usage, reasoningTokens: 15 });
    return finish('Gedacht.');
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
    return finish('Fertig.');
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
    return finish('Zu spät.');
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
      text: 'Offen: Müller anrufen',
      chips: [{ id: note.id, title: 'Müller anrufen' }],
      partial: false,
      stopped: null,
    });
    const usageDoc = (await assistantUsageCol(ctx.db, fx.ownerId).doc(usageDay()).get()).data();
    expect(usageDoc?.tokens).toBe(120);
    expect(usageDoc?.inFlight).toEqual({});
  });

  it('offers the model read tools that never ask for a board id', async () => {
    const fx = await createBoardFixture(ctx);
    expect((await turn(fx.ownerToken, fx.boardId, 'eins')).statusCode).toBe(200);
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
    const elsewhere = (await createNote(fx.editToken, fx.editorId, 'Anderes Board')).json();
    const here = (await createNote(fx.ownerToken, fx.boardId, 'Hier')).json();
    const foreign = await turn(fx.editToken, fx.boardId, `get:${elsewhere.id}`);
    expect(foreign.json().conversation.entries[1]).toMatchObject({
      text: 'error:NOT_FOUND',
      chips: [],
    });
    const own = await turn(fx.editToken, fx.boardId, `get:${here.id}`);
    expect(own.json().conversation.entries[1]).toMatchObject({
      text: 'Hier',
      chips: [{ id: here.id, title: 'Hier' }],
    });
  });

  it('settles output tokens once, reasoning included, as the providers report them', async () => {
    const fx = await createBoardFixture(ctx);
    expect((await turn(fx.ownerToken, fx.boardId, 'thinking')).statusCode).toBe(200);
    const usageDoc = (await assistantUsageCol(ctx.db, fx.ownerId).doc(usageDay()).get()).data();
    expect(usageDoc?.tokens).toBe(120);
  });

  it('reserves each later step with the tool results gathered so far this turn', async () => {
    const fx = await createBoardFixture(ctx);
    for (let i = 0; i < 10; i++)
      await createNote(fx.ownerToken, fx.boardId, `${i} ${'Langer Titel '.repeat(12)}`);
    const res = await turn(fx.ownerToken, fx.boardId, 'grow');
    expect(res.statusCode).toBe(200);
    const resultChars = Number(
      (res.json().conversation.entries[1].text as string).slice('chars:'.length),
    );
    expect(resultChars).toBeGreaterThan(1000);
    const reserved = (await assistantAttemptsCol(ctx.db, fx.ownerId).get()).docs
      .map((d) => d.data().reservedTokens)
      .sort((a, b) => a - b);
    expect(reserved).toHaveLength(2);
    expect(reserved[1]! - reserved[0]!).toBeGreaterThanOrEqual(
      Math.ceil(resultChars / CHARS_PER_TOKEN),
    );
  });

  it('answers a provider failure with its own error and none of the provider text', async () => {
    const fx = await createBoardFixture(ctx);
    for (const script of ['provider-error', 'provider-400']) {
      const res = await turn(fx.ownerToken, fx.boardId, script);
      expect(res.statusCode, script).toBe(502);
      expect(res.json()).toEqual({
        error: 'ASSISTANT_PROVIDER_ERROR',
        message: 'The model provider failed',
      });
      expect(res.body).not.toContain('secret-project-42');
    }
  });

  it('drops a stored chip once its note is out of sight, keeping the text', async () => {
    const fx = await createBoardFixture(ctx);
    const note = (await createNote(fx.ownerToken, fx.boardId, 'Bald privat')).json();
    const first = (await turn(fx.editToken, fx.boardId, `markers:Siehe [note:${note.id}].`)).json()
      .conversation;
    expect(first.entries[1].chips).toEqual([{ id: note.id, title: 'Bald privat' }]);
    const patch = await ctx.inject({
      method: 'PATCH',
      url: `/notes/${note.id}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { visibility: 'PRIVATE' },
    });
    expect(patch.statusCode).toBe(200);
    for (const path of [first.id, 'latest']) {
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/assistant/conversations/${path}`,
        headers: ctx.authHeader(fx.editToken),
      });
      expect(res.statusCode, path).toBe(200);
      expect(res.json().entries[1], path).toMatchObject({ text: 'Siehe Bald privat.', chips: [] });
    }
    // The owner still sees the note, and so the chip.
    const owner = await turn(fx.ownerToken, fx.boardId, `markers:[note:${note.id}]`);
    expect(owner.json().conversation.entries[1].chips).toEqual([
      { id: note.id, title: 'Bald privat' },
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
    const res = await turn(fx.ownerToken, fx.boardId, 'limit', first.id);
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
    const res = await turn(fx.ownerToken, fx.boardId, 'limit-last', first.id);
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
    const res = await turn(fx.ownerToken, fx.boardId, 'limit-next');
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

  it('rejects an unknown time zone and a malformed conversation id with 400, not 500', async () => {
    const fx = await createBoardFixture(ctx);
    const post = (payload: Record<string, unknown>) =>
      ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/assistant/turns`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { ...body('eins'), ...payload },
      });
    const zone = await post({ timeZone: 'Mars/Olympus_Mons' });
    expect(zone.statusCode).toBe(400);
    expect(zone.json().error).toBe('BAD_REQUEST');
    for (const conversationId of ['a/b', 'x'.repeat(129), 'with space']) {
      const id = await post({ conversationId });
      expect(id.statusCode, conversationId).toBe(400);
      expect(id.json().error, conversationId).toBe('BAD_REQUEST');
    }
    expect((await assistantConversationsCol(ctx.db, fx.ownerId).get()).size).toBe(0);
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
