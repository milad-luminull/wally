import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '../../../test/postgres.js';
import {
  assistantAttempts,
  assistantAudit,
  assistantConversations,
  assistantSuggestions,
  assistantTidies,
  assistantUsage,
  boardCleanup,
  boardMembers,
  boardOperations,
  deletedIdentities,
  notes,
  shareLinks,
  users,
  whiteboards,
} from '../postgres/schema/index.js';
import { assertPurgeScheduled, purgeExpired } from './purge.js';

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

  it('deletes rows past their expiry from the seven expiring tables, and nothing else', async () => {
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
      await db
        .insert(deletedIdentities)
        .values({ issuer: 'https://issuer/', subject: suffix, expiresAt });
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
      deletedIdentities: 2,
      shareLinks: 0,
      pendingInvites: 0,
      assistantUsage: 0,
    });
    for (const table of [
      boardOperations,
      assistantAudit,
      assistantAttempts,
      assistantConversations,
      assistantSuggestions,
      assistantTidies,
      deletedIdentities,
    ])
      expect(await db.$count(table)).toBe(1);
    expect(await db.$count(boardCleanup)).toBe(1);
  });
});

describe('purgeExpired and the retention periods (2026-11-04)', () => {
  let handle: TestDatabase;
  const DAY = 86_400_000;
  const ago = (ms: number) => new Date(now.getTime() - ms);

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  beforeEach(async () => {
    const { db } = handle;
    await db.execute(sql`truncate users, whiteboards cascade`);
    await db.insert(users).values(
      ['owner', 'linked', 'invited', 'other'].map((id) => ({
        id,
        email: `${id}@example.com`,
        emailVerified: true,
        language: 'en' as const,
        createdAt: at,
        updatedAt: at,
      })),
    );
    await db.insert(whiteboards).values(
      ['b-expired', 'b-live', 'b-never'].map((id) => ({
        id,
        ownerId: 'owner',
        name: id,
        createdAt: at,
        updatedAt: at,
      })),
    );
    await db.insert(shareLinks).values([
      {
        token: 't-expired',
        boardId: 'b-expired',
        role: 'EDIT',
        expiresAt: now,
        createdAt: at,
        updatedAt: at,
      },
      {
        token: 't-live',
        boardId: 'b-live',
        role: 'EDIT',
        expiresAt: future,
        createdAt: at,
        updatedAt: at,
      },
      {
        token: 't-never',
        boardId: 'b-never',
        role: 'EDIT',
        expiresAt: null,
        createdAt: at,
        updatedAt: at,
      },
    ]);
    const member = (id: string, boardId: string, userId: string, joinedByLink: boolean) => ({
      id,
      boardId,
      userId,
      role: 'EDIT' as const,
      status: 'ACTIVE' as const,
      invitedAt: at,
      joinedByLink,
    });
    await db
      .insert(boardMembers)
      .values([
        member('m-expired-link', 'b-expired', 'linked', true),
        member('m-expired-invited', 'b-expired', 'invited', false),
        member('m-live-link', 'b-live', 'linked', true),
        member('m-never-link', 'b-never', 'linked', true),
      ]);
    await db.insert(notes).values({
      id: 'n-linked',
      boardId: 'b-expired',
      title: 'n',
      status: 'OPEN',
      priority: 'MEDIUM',
      horizon: 'THIS_WEEK',
      freeX: 0,
      freeY: 0,
      colour: 'CHALK',
      createdById: 'linked',
      assigneeId: 'linked',
      createdAt: at,
      updatedAt: at,
    });
  });

  it('removes an expired link and its link members, releasing their shared notes', async () => {
    const { db } = handle;
    const purged = await purgeExpired(db, now);
    expect(purged.shareLinks).toBe(1);

    const links = await db
      .select({ token: shareLinks.token })
      .from(shareLinks)
      .orderBy(asc(shareLinks.token));
    expect(links.map((row) => row.token)).toEqual(['t-live', 't-never']);
    const members = await db
      .select({ id: boardMembers.id })
      .from(boardMembers)
      .orderBy(asc(boardMembers.id));
    expect(members.map((row) => row.id)).toEqual([
      'm-expired-invited',
      'm-live-link',
      'm-never-link',
    ]);
    const [note] = await db.select().from(notes).where(eq(notes.id, 'n-linked'));
    expect(note!.assigneeId).toBeNull();
    const [board] = await db.select().from(whiteboards).where(eq(whiteboards.id, 'b-expired'));
    expect(board!.revision).toBe(2);
    const [untouched] = await db.select().from(whiteboards).where(eq(whiteboards.id, 'b-live'));
    expect(untouched!.revision).toBe(1);
  });

  it('deletes pending invites at 30 days, not a second earlier, and never active rows', async () => {
    const { db } = handle;
    const invite = (id: string, invitedAt: Date, status: 'PENDING' | 'ACTIVE') => ({
      id,
      boardId: 'b-live',
      userId: status === 'ACTIVE' ? 'other' : null,
      invitedEmail: status === 'PENDING' ? `${id}@example.com` : null,
      role: 'VIEW' as const,
      status,
      invitedAt,
    });
    await db
      .insert(boardMembers)
      .values([
        invite('p-30-days', ago(30 * DAY), 'PENDING'),
        invite('p-almost', ago(30 * DAY - 1000), 'PENDING'),
        invite('a-old', ago(90 * DAY), 'ACTIVE'),
      ]);
    const purged = await purgeExpired(db, now);
    expect(purged.pendingInvites).toBe(1);
    const ids = (await db.select({ id: boardMembers.id }).from(boardMembers)).map((row) => row.id);
    expect(ids).not.toContain('p-30-days');
    expect(ids).toEqual(expect.arrayContaining(['p-almost', 'a-old']));
  });

  it('deletes usage counters older than 30 days and keeps the boundary day', async () => {
    const { db } = handle;
    // `now` is 2026-10-31: 30 days back is 2026-10-01.
    await db.insert(assistantUsage).values(
      ['2026-09-30', '2026-10-01', '2026-10-31'].map((day) => ({
        userId: 'other',
        day,
        tokens: 1,
        updatedAt: at,
      })),
    );
    const purged = await purgeExpired(db, now);
    expect(purged.assistantUsage).toBe(1);
    const days = (
      await db
        .select({ day: assistantUsage.day })
        .from(assistantUsage)
        .orderBy(asc(assistantUsage.day))
    ).map((row) => row.day);
    expect(days).toEqual(['2026-10-01', '2026-10-31']);
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
      'assistant_usage',
      'board_members',
      'board_operations',
      'deleted_identities',
      'share_links',
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

describe('assertPurgeScheduled', () => {
  let handle: TestDatabase;

  beforeAll(async () => {
    handle = await createTestDatabase();
  });

  afterAll(async () => {
    await handle?.drop();
  });

  it('refuses a database where pg_cron has no purge job, so retention is never left unenforced', async () => {
    // A per-file test database is not pg_cron's database, so the migration scheduled nothing.
    await expect(assertPurgeScheduled(handle.db)).rejects.toThrow(/wally-purge-expired/);
  });
});
