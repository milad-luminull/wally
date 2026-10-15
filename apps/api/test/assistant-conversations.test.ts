import { Timestamp } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  appendTurn,
  CONVERSATION_RETENTION_DAYS,
  createConversation,
  latestOpenConversation,
  loadConversation,
  MAX_TURNS,
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
      user: entry('user', 'a'),
      assistant: entry('assistant', 'b'),
      messages: [{ x: 1 }],
      usage,
      toolCalls: 0,
      now,
    });
    const after = await appendTurn(ctx.db, 'u1', c.id, {
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
      user: entry('user', 'q'),
      assistant: entry('assistant', 'a'),
      messages: [{ content: big }, { content: big }],
      usage,
      toolCalls: 0,
      now,
    });
    expect(after.status).toBe('CLOSED');
    expect(Timestamp.now().toMillis()).toBeGreaterThan(0);
  });
});
