import { Timestamp } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  appendTurn,
  CONVERSATION_RETENTION_DAYS,
  createConversation,
  latestOpenConversation,
  loadConversation,
  MAX_MESSAGES_BYTES,
  MAX_TURNS,
  messagesBytes,
  toConversationDto,
} from '../src/lib/assistant/conversations.js';
import { buildTestApp, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-assistant-conversations';
const now = new Date('2026-10-15T10:00:00.000Z');
const entry = (role: 'user' | 'assistant', text: string) => ({
  role,
  text,
  chips: [],
  partial: false,
  stopped: null,
  at: now.toISOString(),
});
const usage = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 0 };

describe('assistant conversations', () => {
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

  it('creates, appends and exposes a DTO with entries in order', async () => {
    const c = await createConversation(ctx.db, 'u1', 'b1', 'vertex:gemini-3.8-flash', now);
    expect(c).toMatchObject({ boardId: 'b1', status: 'OPEN', turns: 0, entries: [], messages: [] });
    expect(c.expiresAt.toMillis() - c.lastTurnAt.toMillis()).toBe(
      CONVERSATION_RETENTION_DAYS * 86_400_000,
    );
    const after = await appendTurn(ctx.db, 'u1', c.id, {
      expectedTurns: 0,
      user: entry('user', 'Was ist offen?'),
      assistant: entry('assistant', 'Nichts.'),
      messages: [
        { role: 'user', content: 'Was ist offen?' },
        { role: 'assistant', content: 'Nichts.' },
      ],
      usage,
      toolCalls: 1,
      now: new Date(now.getTime() + 60_000),
    });
    expect(after.turns).toBe(1);
    expect(after.usage).toEqual(usage);
    expect(after.toolCalls).toBe(1);
    expect(after.messages).toHaveLength(2);
    expect(after.lastTurnAt.toMillis()).toBe(now.getTime() + 60_000);
    const dto = toConversationDto(after);
    expect(dto).toMatchObject({
      id: c.id,
      boardId: 'b1',
      status: 'OPEN',
      model: 'vertex:gemini-3.8-flash',
    });
    expect(dto.entries.map((e) => [e.role, e.text])).toEqual([
      ['user', 'Was ist offen?'],
      ['assistant', 'Nichts.'],
    ]);
    expect(dto).not.toHaveProperty('messages');
  });

  it('keeps the stored messages when a turn is stopped and still records both entries', async () => {
    const c = await createConversation(ctx.db, 'u1', 'b1', 'm', now);
    await appendTurn(ctx.db, 'u1', c.id, {
      expectedTurns: 0,
      user: entry('user', 'a'),
      assistant: entry('assistant', 'b'),
      messages: [{ x: 1 }],
      usage,
      toolCalls: 0,
      now,
    });
    const after = await appendTurn(ctx.db, 'u1', c.id, {
      expectedTurns: 1,
      user: entry('user', 'c'),
      assistant: { ...entry('assistant', ''), stopped: 'TOOL_LIMIT' },
      messages: null,
      usage: null,
      toolCalls: 13,
      now,
    });
    expect(after.messages).toEqual([{ x: 1 }]);
    expect(after.entries).toHaveLength(4);
    expect(after.turns).toBe(2);
    expect(after.toolCalls).toBe(13);
  });

  it('is found only by its owner on its board', async () => {
    const c = await createConversation(ctx.db, 'u1', 'b1', 'm', now);
    expect(await loadConversation(ctx.db, 'u1', 'b1', c.id)).not.toBeNull();
    expect(await loadConversation(ctx.db, 'u2', 'b1', c.id)).toBeNull();
    expect(await loadConversation(ctx.db, 'u1', 'b2', c.id)).toBeNull();
  });

  it('returns the latest open conversation for a user and board', async () => {
    const older = await createConversation(ctx.db, 'u1', 'b1', 'm', now);
    const newer = await createConversation(ctx.db, 'u1', 'b1', 'm', new Date(now.getTime() + 1000));
    await createConversation(ctx.db, 'u1', 'b2', 'm', new Date(now.getTime() + 2000));
    expect((await latestOpenConversation(ctx.db, 'u1', 'b1'))?.id).toBe(newer.id);
    for (let i = 0; i < MAX_TURNS; i++)
      await appendTurn(ctx.db, 'u1', newer.id, {
        expectedTurns: i,
        user: entry('user', 'q'),
        assistant: entry('assistant', 'a'),
        messages: [],
        usage,
        toolCalls: 0,
        now,
      });
    expect((await loadConversation(ctx.db, 'u1', 'b1', newer.id))?.status).toBe('CLOSED');
    expect((await latestOpenConversation(ctx.db, 'u1', 'b1'))?.id).toBe(older.id);
  });

  it('closes when the stored messages approach the document limit', async () => {
    const c = await createConversation(ctx.db, 'u1', 'b1', 'm', now);
    const big = 'x'.repeat(300 * 1024);
    const after = await appendTurn(ctx.db, 'u1', c.id, {
      expectedTurns: 0,
      user: entry('user', 'q'),
      assistant: entry('assistant', 'a'),
      messages: [{ content: big }, { content: big }],
      usage,
      toolCalls: 0,
      now,
    });
    expect(after.status).toBe('CLOSED');
    expect(Timestamp.now().toMillis()).toBeGreaterThan(0);
    // The oversized history is not stored; the previous one is kept.
    expect(after.messages).toEqual([]);
    expect(after.entries).toHaveLength(2);
  });

  it('measures the history in UTF-8 bytes, not UTF-16 code units', async () => {
    // 200 Ki umlauts: 200 Ki code units but 400 KiB of UTF-8, twice over the bound.
    const umlauts = 'ä'.repeat(200 * 1024);
    const history = [{ content: umlauts }, { content: umlauts }];
    expect(JSON.stringify(history).length).toBeLessThan(MAX_MESSAGES_BYTES);
    expect(messagesBytes(history)).toBeGreaterThan(MAX_MESSAGES_BYTES);
    const c = await createConversation(ctx.db, 'u1', 'b1', 'm', now);
    await appendTurn(ctx.db, 'u1', c.id, {
      expectedTurns: 0,
      user: entry('user', 'a'),
      assistant: entry('assistant', 'b'),
      messages: [{ x: 1 }],
      usage,
      toolCalls: 0,
      now,
    });
    const after = await appendTurn(ctx.db, 'u1', c.id, {
      expectedTurns: 1,
      user: entry('user', 'c'),
      assistant: entry('assistant', 'd'),
      messages: history,
      usage,
      toolCalls: 0,
      now,
    });
    expect(after.status).toBe('CLOSED');
    expect(after.messages).toEqual([{ x: 1 }]);
    expect(after.entries).toHaveLength(4);
    const stored = await loadConversation(ctx.db, 'u1', 'b1', c.id);
    expect(stored).toMatchObject({ status: 'CLOSED', turns: 2, messages: [{ x: 1 }] });
    expect(stored?.entries.map((e) => e.text)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('records the turn and closes when the new history alone would pass the document limit', async () => {
    const c = await createConversation(ctx.db, 'u1', 'b1', 'm', now);
    const huge = 'x'.repeat(1200 * 1024);
    const after = await appendTurn(ctx.db, 'u1', c.id, {
      expectedTurns: 0,
      user: entry('user', 'q'),
      assistant: entry('assistant', 'a'),
      messages: [{ content: huge }],
      usage,
      toolCalls: 12,
      now,
    });
    expect(after).toMatchObject({ status: 'CLOSED', turns: 1, messages: [], toolCalls: 12 });
    const stored = await loadConversation(ctx.db, 'u1', 'b1', c.id);
    expect(stored).toMatchObject({ status: 'CLOSED', turns: 1, messages: [] });
    expect(stored?.entries.map((e) => e.text)).toEqual(['q', 'a']);
    expect(await latestOpenConversation(ctx.db, 'u1', 'b1')).toBeNull();
  });

  it('refuses a turn recorded against a stale turn count and leaves the document untouched', async () => {
    const c = await createConversation(ctx.db, 'u1', 'b1', 'm', now);
    const first = {
      expectedTurns: 0,
      user: entry('user', 'a'),
      assistant: entry('assistant', 'b'),
      messages: [{ x: 1 }],
      usage,
      toolCalls: 0,
      now,
    };
    await appendTurn(ctx.db, 'u1', c.id, first);
    await expect(
      appendTurn(ctx.db, 'u1', c.id, { ...first, messages: [{ x: 2 }] }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'ASSISTANT_CONVERSATION_CLOSED' });
    const stored = await loadConversation(ctx.db, 'u1', 'b1', c.id);
    expect(stored).toMatchObject({ turns: 1, messages: [{ x: 1 }] });
    expect(stored?.entries).toHaveLength(2);
  });

  it('lets only one of two concurrent turns on the same conversation commit', async () => {
    const c = await createConversation(ctx.db, 'u1', 'b1', 'm', now);
    const turn = (text: string) => ({
      expectedTurns: 0,
      user: entry('user', text),
      assistant: entry('assistant', text),
      messages: [{ content: text }],
      usage,
      toolCalls: 0,
      now,
    });
    const results = await Promise.allSettled([
      appendTurn(ctx.db, 'u1', c.id, turn('tab one')),
      appendTurn(ctx.db, 'u1', c.id, turn('tab two')),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 409,
      code: 'ASSISTANT_CONVERSATION_CLOSED',
    });
    const stored = await loadConversation(ctx.db, 'u1', 'b1', c.id);
    expect(stored?.turns).toBe(1);
    expect(stored?.entries).toHaveLength(2);
    // The stored history belongs to the turn whose entries were stored.
    expect(stored?.messages).toEqual([{ content: stored?.entries[0]?.text }]);
  });

  it('refuses a turn on a closed conversation, so none is recorded past MAX_TURNS', async () => {
    const c = await createConversation(ctx.db, 'u1', 'b1', 'm', now);
    for (let i = 0; i < MAX_TURNS; i++)
      await appendTurn(ctx.db, 'u1', c.id, {
        expectedTurns: i,
        user: entry('user', 'q'),
        assistant: entry('assistant', 'a'),
        messages: [],
        usage,
        toolCalls: 0,
        now,
      });
    await expect(
      appendTurn(ctx.db, 'u1', c.id, {
        expectedTurns: MAX_TURNS,
        user: entry('user', 'q'),
        assistant: entry('assistant', 'a'),
        messages: [],
        usage,
        toolCalls: 0,
        now,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'ASSISTANT_CONVERSATION_CLOSED' });
    const stored = await loadConversation(ctx.db, 'u1', 'b1', c.id);
    expect(stored).toMatchObject({ status: 'CLOSED', turns: MAX_TURNS });
    expect(stored?.entries).toHaveLength(MAX_TURNS * 2);
  });
});
