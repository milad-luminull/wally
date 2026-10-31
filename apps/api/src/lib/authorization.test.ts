import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import type { NoteVisibility } from '@wally/shared';
import type { Database } from './postgres/client.js';
import { notes, whiteboards } from './postgres/schema/index.js';
import {
  createTestBoard,
  createTestDatabase,
  createTestMembership,
  createTestUser,
  resetDatabase,
  type TestDatabase,
} from '../../test/helpers.js';
import { getEffectiveRole, requireWhiteboardAccess } from './authorization.js';

let handle: TestDatabase;
let db: Database;

beforeAll(async () => {
  handle = await createTestDatabase();
  db = handle.db;
});

afterAll(async () => {
  await handle?.drop();
});

describe('getEffectiveRole', () => {
  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function makeFixture() {
    await createTestUser(db, 'u-owner', 'owner@example.com');
    await createTestUser(db, 'u-edit', 'edit@example.com');
    await createTestUser(db, 'u-view', 'view@example.com');
    await createTestUser(db, 'u-pending', 'pending@example.com');
    await createTestUser(db, 'u-stranger', 'stranger@example.com');

    // Only ACTIVE memberships grant a role — that is exactly the distinction this function
    // is being asked about.
    const board = await createTestBoard(db, 'u-owner', { 'u-edit': 'EDIT', 'u-view': 'VIEW' });
    await createTestMembership(db, board, { userId: 'u-pending', role: 'EDIT', status: 'PENDING' });
    return { board };
  }

  it('returns OWNER for the board owner', async () => {
    const { board } = await makeFixture();
    await expect(getEffectiveRole(db, 'u-owner', board)).resolves.toBe('OWNER');
  });

  it('returns EDIT for an active EDIT member', async () => {
    const { board } = await makeFixture();
    await expect(getEffectiveRole(db, 'u-edit', board)).resolves.toBe('EDIT');
  });

  it('returns VIEW for an active VIEW member', async () => {
    const { board } = await makeFixture();
    await expect(getEffectiveRole(db, 'u-view', board)).resolves.toBe('VIEW');
  });

  it('returns null for a PENDING member (not yet active)', async () => {
    const { board } = await makeFixture();
    await expect(getEffectiveRole(db, 'u-pending', board)).resolves.toBeNull();
  });

  it('returns null for a non-member', async () => {
    const { board } = await makeFixture();
    await expect(getEffectiveRole(db, 'u-stranger', board)).resolves.toBeNull();
  });

  it('returns null for a tombstoned whiteboard, even for its owner', async () => {
    const { board } = await makeFixture();
    await db.update(whiteboards).set({ deletedAt: new Date() }).where(eq(whiteboards.id, board));
    await expect(getEffectiveRole(db, 'u-owner', board)).resolves.toBeNull();
  });

  it('returns null for a nonexistent whiteboard', async () => {
    await makeFixture();
    await expect(getEffectiveRole(db, 'u-stranger', 'does-not-exist')).resolves.toBeNull();
  });
});

describe('requireWhiteboardAccess({ kind: noteParam })', () => {
  beforeEach(async () => {
    await resetDatabase(db);
  });

  async function makeNote(id: string, creatorId: string, visibility: NoteVisibility) {
    const timestamp = new Date();
    await db.insert(notes).values({
      id,
      boardId: 'u-owner',
      title: 'Ask Anna about Müller',
      status: 'OPEN',
      completedAt: null,
      priority: 'MEDIUM',
      horizon: 'TODAY',
      freeX: 0,
      freeY: 0,
      dueDate: null,
      assigneeId: creatorId,
      tags: [],
      customFields: {},
      colour: 'CHALK',
      visibility,
      createdById: creatorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  /** Runs the preHandler directly with a minimal request and a reply that records its answer. */
  async function run(noteId: string, userId: string) {
    const request = {
      params: { id: noteId },
      server: { db },
      user: { id: userId },
    } as unknown as FastifyRequest;
    const sent: { status?: number; body?: unknown } = {};
    const reply = {
      code(status: number) {
        sent.status = status;
        return this;
      },
      send(body: unknown) {
        sent.body = body;
        return this;
      },
    } as unknown as FastifyReply;
    await requireWhiteboardAccess({ kind: 'noteParam' }).call(
      {} as never,
      request,
      reply,
      () => {},
    );
    return { sent, request };
  }

  async function makeBoard() {
    await createTestUser(db, 'u-owner', 'owner@example.com');
    await createTestUser(db, 'u-edit', 'edit@example.com');
    await createTestBoard(db, 'u-owner', { 'u-edit': 'EDIT' });
  }

  it('answers a member who did not create a private note exactly as for a missing note', async () => {
    await makeBoard();
    await makeNote('n-private', 'u-edit', 'PRIVATE');

    const missing = await run('does-not-exist', 'u-owner');
    const hidden = await run('n-private', 'u-owner');

    expect(hidden.sent).toEqual({
      status: 404,
      body: { error: 'NOT_FOUND', message: 'Not found' },
    });
    expect(hidden.sent).toEqual(missing.sent);
    expect(hidden.request.noteContext).toBeUndefined();
    expect(hidden.request.whiteboardContext).toBeUndefined();
  });

  it('lets the creator through to their own private note', async () => {
    await makeBoard();
    await makeNote('n-private', 'u-edit', 'PRIVATE');

    const { sent, request } = await run('n-private', 'u-edit');

    expect(sent).toEqual({});
    expect(request.noteContext?.id).toBe('n-private');
    expect(request.whiteboardContext).toMatchObject({ whiteboardId: 'u-owner', role: 'EDIT' });
  });

  it('lets any member through to a shared note', async () => {
    await makeBoard();
    await makeNote('n-shared', 'u-edit', 'SHARED');

    const { sent, request } = await run('n-shared', 'u-owner');

    expect(sent).toEqual({});
    expect(request.whiteboardContext).toMatchObject({ role: 'OWNER' });
  });
});
