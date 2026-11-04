import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { accountExportSchema } from '@wally/shared';
import { assistantConversations, mcpConnections } from '../src/lib/postgres/schema/index.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

describe('GET /me/export', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp();
  });
  afterEach(() => resetDatabase(ctx.db));
  afterAll(async () => {
    await resetDatabase(ctx.db);
    await ctx.app.close();
  });

  const create = async (token: string, boardId: string, body: Record<string, unknown>) =>
    (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${boardId}/notes`,
        headers: ctx.authHeader(token),
        payload: body,
      })
    ).json() as { id: string };

  async function boardWithNotes() {
    const fx = await createBoardFixture(ctx);
    const shared = await create(fx.ownerToken, fx.boardId, { title: 'Shared plan' });
    await ctx.inject({
      method: 'POST',
      url: `/notes/${shared.id}/subtasks`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { text: 'First step' },
    });
    await create(fx.ownerToken, fx.boardId, { title: 'My secret', visibility: 'PRIVATE' });
    await create(fx.editToken, fx.boardId, { title: 'Their secret', visibility: 'PRIVATE' });
    return fx;
  }
  const exportOf = (token: string) =>
    ctx.inject({ method: 'GET', url: '/me/export', headers: ctx.authHeader(token) });

  it('contains the board, its members, and its notes with subtasks and history', async () => {
    const fx = await boardWithNotes();
    const res = await exportOf(fx.ownerToken);
    expect(res.statusCode).toBe(200);
    const data = accountExportSchema.parse(res.json());
    expect(data.formatVersion).toBe(1);
    expect(data.profile.id).toBe(fx.ownerId);
    const board = data.boards.find((b) => b.id === fx.boardId)!;
    expect(board.currentUserRole).toBe('OWNER');
    expect(board.members.map((m) => m.email).sort()).toEqual([
      'editor@fixture.de',
      'owner@fixture.de',
      'viewer@fixture.de',
    ]);
    const shared = board.notes.find((n) => n.title === 'Shared plan')!;
    expect(shared.subtasks.map((s) => s.text)).toEqual(['First step']);
    expect(shared.history.map((h) => h.type)).toEqual(['CREATED']);
  });

  it('includes their own private notes and never anyone else’s', async () => {
    const fx = await boardWithNotes();
    const data = accountExportSchema.parse((await exportOf(fx.ownerToken)).json());
    const titles = data.boards.find((b) => b.id === fx.boardId)!.notes.map((n) => n.title);
    expect(titles).toContain('My secret');
    expect(titles).not.toContain('Their secret');
  });

  it('drops assistant chips for notes the person can no longer see', async () => {
    const fx = await createBoardFixture(ctx);
    const shared = await create(fx.ownerToken, fx.boardId, { title: 'Shared plan' });
    const hidden = await create(fx.editToken, fx.boardId, { title: 'Their secret' });
    await ctx.inject({
      method: 'PATCH',
      url: `/notes/${hidden.id}`,
      headers: ctx.authHeader(fx.editToken),
      payload: { visibility: 'PRIVATE' },
    });
    const at = new Date();
    await ctx.db.insert(assistantConversations).values({
      id: 'conversation-1',
      userId: fx.ownerId,
      boardId: fx.boardId,
      model: 'vertex:gemini',
      status: 'OPEN',
      turns: 1,
      messages: [],
      entries: [
        {
          role: 'assistant',
          text: 'Two notes match.',
          chips: [
            { id: shared.id, title: 'Shared plan' },
            { id: hidden.id, title: 'Their secret' },
          ],
          partial: false,
          stopped: null,
          at: at.toISOString(),
        },
      ],
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
      toolCalls: 0,
      createdAt: at,
      lastTurnAt: at,
      expiresAt: new Date(at.getTime() + 86_400_000),
    });

    const data = accountExportSchema.parse((await exportOf(fx.ownerToken)).json());
    const [conversation] = data.assistant.conversations;
    expect(conversation!.entries[0]!.chips).toEqual([{ id: shared.id, title: 'Shared plan' }]);
    expect(JSON.stringify(data)).not.toContain('Their secret');
  });

  it('lists their MCP connections', async () => {
    const fx = await createBoardFixture(ctx);
    const id = randomUUID();
    await ctx.db.insert(mcpConnections).values({
      id,
      userId: fx.ownerId,
      clientId: 'client',
      name: 'ChatGPT',
      scopes: ['wally:read'],
      createdAt: new Date(),
      issuedAfter: 0,
    });
    const data = accountExportSchema.parse((await exportOf(fx.ownerToken)).json());
    expect(data.connections.map((c) => c.id)).toEqual([id]);
  });

  it('is a JSON attachment named for its UTC date', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await exportOf(fx.ownerToken);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const day = res.json().exportedAt.slice(0, 10);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="wally-export-${day}.json"`,
    );
  });
});
