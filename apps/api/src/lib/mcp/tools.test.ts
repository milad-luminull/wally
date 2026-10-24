import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, getTestDb, resetDatabase } from '../../../test/helpers.js';
import { notesCol, now, whiteboardsCol } from '../db/collections.js';
import { AppError } from '../errors.js';
import { availableMcpTools, runMcpTool, type McpToolContext } from './tools.js';

const projectId = 'wally-mcp-tools';
const db = getTestDb(projectId);
let context: McpToolContext;
beforeEach(async () => {
  await resetDatabase(projectId);
  await createTestUser(db, 'owner', 'owner@example.com');
  const timestamp = now();
  await whiteboardsCol(db).doc('board').set({
    name: 'Board',
    shareLinkToken: null,
    ownerId: 'owner',
    memberRoles: {},
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  context = {
    db,
    actor: { id: 'owner', email: 'owner@example.com', emailVerified: true },
    connectionId: 'connection',
    scopes: ['wally:read', 'wally:write'],
    authorizeBoard: async () => {},
  };
});
const create = (input = {}) =>
  runMcpTool(context, 'create_note', { boardId: 'board', operationId: randomUUID(), input });

describe('MCP operations', () => {
  it('offers exactly five reads and eight bounded writes', () => {
    expect(
      availableMcpTools(['wally:read'])
        .map((t) => t.name)
        .sort(),
    ).toEqual(['get_board', 'get_note', 'list_boards', 'list_members', 'list_notes']);
    expect(availableMcpTools(context.scopes)).toHaveLength(13);
    expect(availableMcpTools([])).toEqual([]);
  });
  it('discovers empty boards and filters revoked board grants', async () => {
    expect((await runMcpTool(context, 'list_boards', {})).data).toHaveLength(1);
    expect((await runMcpTool(context, 'list_notes', { boardId: 'board' })).data).toMatchObject({
      notes: [],
      nextCursor: null,
    });
    expect((await runMcpTool(context, 'get_board', { boardId: 'board' })).data).toMatchObject({
      id: 'board',
      revision: 1,
    });
    expect((await runMcpTool(context, 'list_members', { boardId: 'board' })).data).toHaveLength(1);
    context.authorizeBoard = async () => {
      throw new AppError(403, 'FORBIDDEN', 'Revoked');
    };
    expect((await runMcpTool(context, 'list_boards', {})).data).toEqual([]);
  });
  it('discovers newly accessible boards and excludes nonmember boards', async () => {
    const source = (await whiteboardsCol(db).doc('board').get()).data()!;
    await whiteboardsCol(db)
      .doc('second')
      .set({ ...source, name: 'Second' });
    expect((await runMcpTool(context, 'list_boards', {})).data).toHaveLength(2);
    await whiteboardsCol(db).doc('second').update({ ownerId: 'other' });
    expect((await runMcpTool(context, 'list_boards', {})).data).toHaveLength(1);
    await expect(runMcpTool(context, 'get_board', { boardId: 'second' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('does not replay note contents after current visibility is revoked', async () => {
    const args = {
      boardId: 'board',
      operationId: randomUUID(),
      input: { title: 'Originally shared' },
    };
    const result = await runMcpTool(context, 'create_note', args);
    const id = (result.data as { id: string }).id;
    await notesCol(db).doc(id).update({ visibility: 'PRIVATE', createdById: 'other' });
    await expect(runMcpTool(context, 'create_note', args)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await notesCol(db).get()).size).toBe(1);
  });
  it('treats identical intentional creations with different IDs as separate actions', async () => {
    await create({ title: 'Same' });
    await create({ title: 'Same' });
    expect((await notesCol(db).get()).size).toBe(2);
    const audit = await db.collection('assistantAudit').get();
    expect(audit.size).toBe(2);
    for (const row of audit.docs)
      expect(row.data()).toMatchObject({
        via: 'mcp',
        connectionId: 'connection',
        actorId: 'owner',
      });
  });
  it('validates inputs, refuses unknown tools and prevents readonly writes', async () => {
    for (const [name, args] of [
      ['delete_note', {}],
      ['get_note', { noteId: 'a' }],
      ['create_note', { boardId: 'board', input: {} }],
      ['list_notes', { boardId: 'board', limit: 101 }],
    ] as const)
      await expect(runMcpTool(context, name, args)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    context.scopes = ['wally:read'];
    await expect(create()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await notesCol(db).get()).size).toBe(0);
  });
  it('filters private notes, links and refuses wrong-board reads and writes', async () => {
    const shared = (await create({ title: 'Shared' })).data as { id: string };
    const privateNote = (await create({ title: 'Private', visibility: 'PRIVATE' })).data as {
      id: string;
    };
    await notesCol(db).doc(privateNote.id).update({ createdById: 'other' });
    await notesCol(db)
      .doc(shared.id)
      .update({ links: [privateNote.id] });
    expect((await runMcpTool(context, 'list_notes', { boardId: 'board' })).data).toMatchObject({
      notes: [{ id: shared.id, links: [] }],
    });
    await expect(
      runMcpTool(context, 'get_note', { boardId: 'board', noteId: privateNote.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runMcpTool(context, 'get_note', { boardId: 'other', noteId: shared.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runMcpTool(context, 'complete_note', {
        boardId: 'other',
        noteId: shared.id,
        expectedRevision: 1,
        operationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('traverses more than 100 notes with query-bound cursors and property filters', async () => {
    const sample = (await create({ customFields: { Customer: 'A' } })).data as { id: string };
    const stored = (await notesCol(db).doc(sample.id).get()).data()!;
    const batch = db.batch();
    for (let i = 0; i < 105; i++) batch.set(notesCol(db).doc(`copy-${i}`), stored);
    await batch.commit();
    const args = { boardId: 'board', field: 'customer:a', visibility: 'SHARED' };
    const first = (await runMcpTool(context, 'list_notes', args)).data as {
      notes: { id: string }[];
      nextCursor: string;
    };
    expect(first.notes).toHaveLength(100);
    const second = (await runMcpTool(context, 'list_notes', { ...args, cursor: first.nextCursor }))
      .data as { notes: { id: string }[]; nextCursor: string | null };
    expect(second.notes).toHaveLength(6);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.notes, ...second.notes].map((n) => n.id)).size).toBe(106);
    await expect(
      runMcpTool(context, 'list_notes', { boardId: 'board', cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      runMcpTool(context, 'list_notes', { ...args, boardId: 'other', cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('executes all bounded writes, enforces revisions and replays lost responses once per connection', async () => {
    const args = { boardId: 'board', operationId: randomUUID(), input: { title: 'Original' } };
    const first = await runMcpTool(context, 'create_note', args);
    expect(await runMcpTool(context, 'create_note', args)).toEqual(first);
    expect((await notesCol(db).get()).size).toBe(1);
    expect((await db.collection('assistantAudit').get()).size).toBe(1);
    await expect(
      runMcpTool(context, 'create_note', { ...args, input: { title: 'Changed' } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    context.connectionId = 'other-connection';
    await expect(runMcpTool(context, 'create_note', args)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    context.connectionId = 'connection';
    const noteId = (first.data as { id: string }).id;
    const write = (name: string, expectedRevision: number, extra = {}) =>
      runMcpTool(context, name, {
        boardId: 'board',
        noteId,
        expectedRevision,
        operationId: randomUUID(),
        ...extra,
      });
    await expect(write('update_note', 0, { input: { title: 'Stale' } })).rejects.toMatchObject({
      code: 'STALE_REVISION',
    });
    await write('update_note', 1, { input: { title: 'Updated' } });
    await write('move_note', 2, { input: { mode: 'PRIORITY', priority: 'HOCH' } });
    await write('complete_note', 3);
    await write('reopen_note', 4);
    const task = await write('add_subtask', 5, { input: { text: 'Step' } });
    await write('toggle_subtask', 6, {
      subtaskId: (task.data as { id: string }).id,
      input: { done: true },
    });
    await write('assign_note', 7, { input: { assigneeId: 'owner' } });
    expect(
      (await runMcpTool(context, 'get_note', { boardId: 'board', noteId })).data,
    ).toMatchObject({ title: 'Updated', revision: 8, subtasks: [{ done: true }] });
    context.authorizeBoard = async () => {
      throw new AppError(403, 'FORBIDDEN', 'Revoked');
    };
    await expect(runMcpTool(context, 'create_note', args)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
