import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import {
  assistantAttempts,
  assistantAudit,
  assistantConversations,
  assistantSuggestions,
  assistantTidies,
  boardCleanup,
  boardOperations,
  users,
} from '../postgres/schema/index.js';
import { purgeExpired } from './purge.js';

const now = new Date('2026-10-31T12:00:00.000Z');
const past = new Date(now.getTime() - 1);
const future = new Date(now.getTime() + 1);
const at = new Date('2026-10-01T12:00:00.000Z');

describe('purgeExpired', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  it('deletes rows past their expiry from the six expiring tables, and nothing else', async () => {
    const { db } = handle;
    await db.insert(users).values({
      id: 'u1',
      email: 'u1@example.com',
      emailVerified: true,
      language: 'en',
      createdAt: at,
      updatedAt: at,
    });
    // One expired row (exactly at `now` counts as expired), one live row per table.
    for (const [suffix, expiresAt] of [
      ['old', past],
      ['now', now],
      ['live', future],
    ] as const) {
      await db.insert(boardOperations).values({
        userId: 'u1',
        operationId: suffix,
        fingerprint: 'f',
        boardId: 'b1',
        roles: ['OWNER'],
        result: { status: 200, revision: 1, data: null, boardId: 'b1' },
        createdAt: at,
        expiresAt,
      });
      await db.insert(assistantAudit).values({
        operationId: suffix,
        actorId: 'u1',
        boardId: 'b1',
        commandType: 'note.update',
        revision: 1,
        occurredAt: at,
        expiresAt,
      });
      await db.insert(assistantAttempts).values({
        id: suffix,
        userId: 'u1',
        day: '2026-10-01',
        month: '2026-10',
        reservedTokens: 1,
        reservedMicroUsd: 1,
        inputMicroUsdPerToken: 0.1,
        outputMicroUsdPerToken: 0.4,
        state: 'SETTLED',
        createdAt: at,
        expiresAt,
      });
      await db.insert(assistantConversations).values({
        id: suffix,
        userId: 'u1',
        boardId: 'b1',
        model: 'vertex:gemini',
        status: 'CLOSED',
        turns: 1,
        messages: [],
        entries: [],
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
        toolCalls: 0,
        createdAt: at,
        lastTurnAt: at,
        expiresAt,
      });
      await db.insert(assistantSuggestions).values({
        id: suffix,
        userId: 'u1',
        boardId: 'b1',
        noteId: 'n1',
        baseRevision: 1,
        fields: { dueDate: null, priority: null, assignee: null },
        operationIds: {
          dueDate: { apply: 'a', undo: 'b' },
          priority: { apply: 'c', undo: 'd' },
          assignee: { apply: 'e', undo: 'f' },
        },
        status: 'PENDING',
        model: 'vertex:gemini',
        usage: { inputTokens: 0, outputTokens: 0 },
        createdAt: at,
        updatedAt: at,
        expiresAt,
      });
      await db.insert(assistantTidies).values({
        id: suffix,
        userId: 'u1',
        boardId: 'b1',
        status: 'PENDING',
        moves: [],
        createdAt: at,
        updatedAt: at,
        expiresAt,
      });
    }
    await db
      .insert(boardCleanup)
      .values({ id: 'job', kind: 'board.delete', boardId: 'b1', createdAt: at });

    const purged = await purgeExpired(db, now);

    expect(purged).toEqual({
      boardOperations: 2,
      assistantAudit: 2,
      assistantAttempts: 2,
      assistantConversations: 2,
      assistantSuggestions: 2,
      assistantTidies: 2,
    });
    for (const table of [
      boardOperations,
      assistantAudit,
      assistantAttempts,
      assistantConversations,
      assistantSuggestions,
      assistantTidies,
    ])
      expect(await db.$count(table)).toBe(1);
    expect(await db.$count(boardCleanup)).toBe(1);
  });
});

describe('the purge_expired database function', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  it('is what purgeExpired runs, so the cron job and maintenance delete the same rows', async () => {
    const rows = await handle.sql<{ table_name: string; deleted: string }[]>`
      select * from purge_expired(${now.toISOString()}::timestamptz)`;
    expect(rows.map((row) => row.table_name).sort()).toEqual([
      'assistant_attempts',
      'assistant_audit',
      'assistant_conversations',
      'assistant_suggestions',
      'assistant_tidies',
      'board_operations',
    ]);
  });

  it('cannot be called by the Data API roles', async () => {
    const [row] = await handle.sql<{ anon: boolean; authenticated: boolean }[]>`
      select has_function_privilege('anon', 'purge_expired(timestamptz)', 'execute') as anon,
             has_function_privilege('authenticated', 'purge_expired(timestamptz)', 'execute')
               as authenticated`;
    expect(row).toEqual({ anon: false, authenticated: false });
  });
});
