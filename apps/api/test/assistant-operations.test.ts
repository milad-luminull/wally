import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/lib/commands/index.js';
import { runOperation, type OperationContext } from '../src/lib/assistant/run.js';
import type { Provenance } from '../src/lib/assistant/provenance.js';
import { eq } from 'drizzle-orm';
import { assistantAudit } from '../src/lib/postgres/schema/index.js';
import {
  buildTestApp,
  createBoardFixture,
  createTestBoard,
  createTestUser,
  registerTestUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

const provenance: Provenance = { via: 'assistant', conversationId: 'conv-1', approvalId: 'appr-1' };

describe('runOperation', () => {
  let ctx: TestContext;
  let boardId: string;
  let owner: Actor;
  let viewer: Actor;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });
  afterEach(async () => {
    await resetDatabase(ctx.db);
  });
  afterAll(async () => {
    await resetDatabase(ctx.db);
    await ctx.app.close();
  });

  async function fixture() {
    const fx = await createBoardFixture(ctx);
    boardId = fx.boardId;
    owner = { id: fx.ownerId, email: 'owner@fixture.de', emailVerified: true };
    viewer = { id: fx.viewerId, email: 'viewer@fixture.de', emailVerified: true };
  }
  const as = (actor: Actor, overrides: Partial<OperationContext> = {}): OperationContext => ({
    db: ctx.db,
    actor,
    boardId,
    provenance,
    ...overrides,
  });
  const call = (name: string, input: unknown) => ({ name, input, operationId: randomUUID() });
  const create = (actor: Actor, input: Record<string, unknown>) =>
    runOperation(as(actor), call('create_note', { boardId, input }));
  const idOf = (result: { data: unknown }) => (result.data as { id: string }).id;

  it('creates, lists and reads a note', async () => {
    await fixture();
    const created = await create(owner, { title: 'Call Müller', priority: 'HIGH' });
    expect(created.revision).toBe(1);
    const noteId = idOf(created);

    const list = await runOperation(as(owner), call('list_notes', { boardId }));
    expect(list.data).toMatchObject({ truncated: false, total: 1 });
    const rows = (list.data as { notes: { id: string; title: string; revision: number }[] }).notes;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: noteId,
      title: 'Call Müller',
      revision: 1,
      priority: 'HIGH',
    });
    expect(rows[0]).not.toHaveProperty('description');

    const detail = await runOperation(as(owner), call('get_note', { boardId, noteId }));
    expect(detail.revision).toBe(1);
    expect(detail.data).toMatchObject({ id: noteId, title: 'Call Müller', subtasks: [] });
    expect(detail.data).not.toHaveProperty('history');
  });

  it('bounds list_notes and reports truncation', async () => {
    await fixture();
    for (const title of ['a', 'b', 'c']) await create(owner, { title });
    const exact = await runOperation(as(owner), call('list_notes', { boardId, limit: 3 }));
    expect(exact.data).toMatchObject({ truncated: false, total: 3 });
    const cut = await runOperation(as(owner), call('list_notes', { boardId, limit: 2 }));
    expect(cut.data).toMatchObject({ truncated: true, total: 3 });
    expect((cut.data as { notes: unknown[] }).notes).toHaveLength(2);
  });

  it('passes filters through to the query', async () => {
    await fixture();
    await create(owner, { title: 'high', priority: 'HIGH' });
    await create(owner, { title: 'low', priority: 'LOW' });
    const list = await runOperation(
      as(owner),
      call('list_notes', { boardId, priority: ['HIGH'], q: 'hi' }),
    );
    expect((list.data as { notes: { title: string }[] }).notes.map((n) => n.title)).toEqual([
      'high',
    ]);
  });

  it('lists members', async () => {
    await fixture();
    const members = await runOperation(as(owner), call('list_members', { boardId }));
    const rows = members.data as { userId: string | null; role: string }[];
    expect(rows.map((m) => m.role).sort()).toEqual(['EDIT', 'OWNER', 'VIEW']);
  });

  it('runs every write through the command layer with the given revision', async () => {
    await fixture();
    const noteId = idOf(await create(owner, { title: 'x' }));
    const upd = await runOperation(
      as(owner),
      call('update_note', { boardId, noteId, expectedRevision: 1, input: { title: 'y' } }),
    );
    expect(upd.revision).toBe(2);
    const moved = await runOperation(
      as(owner),
      call('move_note', {
        boardId,
        noteId,
        expectedRevision: 2,
        input: { mode: 'HORIZON', horizon: 'LATER' },
      }),
    );
    expect(moved.revision).toBe(3);
    const sub = await runOperation(
      as(owner),
      call('add_subtask', { boardId, noteId, expectedRevision: 3, input: { text: 'Part 1' } }),
    );
    const subtaskId = idOf(sub);
    const toggled = await runOperation(
      as(owner),
      call('toggle_subtask', {
        boardId,
        noteId,
        subtaskId,
        expectedRevision: sub.revision,
        input: { done: true },
      }),
    );
    const detail = await runOperation(as(owner), call('get_note', { boardId, noteId }));
    expect(detail.data).toMatchObject({ subtaskSummary: { total: 1, done: 1 } });
    const done = await runOperation(
      as(owner),
      call('complete_note', { boardId, noteId, expectedRevision: toggled.revision }),
    );
    expect(done.data).toMatchObject({ status: 'DONE' });
    const open = await runOperation(
      as(owner),
      call('reopen_note', { boardId, noteId, expectedRevision: done.revision }),
    );
    expect(open.data).toMatchObject({ status: 'OPEN' });
    const assigned = await runOperation(
      as(owner),
      call('assign_note', {
        boardId,
        noteId,
        expectedRevision: open.revision,
        input: { assigneeId: owner.id },
      }),
    );
    expect(assigned.data).toMatchObject({ assignee: { id: owner.id } });
    await runOperation(
      as(owner),
      call('delete_note', { boardId, noteId, expectedRevision: assigned.revision }),
    );
    await expect(
      runOperation(as(owner), call('get_note', { boardId, noteId })),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await ctx.db.$count(assistantAudit)).toBe(9);
  });

  it('deletes a subtask once, replays on retry, and refuses stale or unknown ones', async () => {
    await fixture();
    const noteId = idOf(await create(owner, { title: 'x' }));
    const sub = await runOperation(
      as(owner),
      call('add_subtask', { boardId, noteId, expectedRevision: 1, input: { text: 'Part 1' } }),
    );
    const subtaskId = idOf(sub);
    const del = call('delete_subtask', {
      boardId,
      noteId,
      subtaskId,
      expectedRevision: sub.revision,
    });

    const deleted = await runOperation(as(owner), del);
    expect(deleted.revision).toBe(sub.revision! + 1);
    const detail = await runOperation(as(owner), call('get_note', { boardId, noteId }));
    expect(detail.data).toMatchObject({
      subtaskSummary: { total: 0, done: 0 },
      revision: deleted.revision,
    });
    const deleteAudits = () =>
      ctx.db.$count(assistantAudit, eq(assistantAudit.commandType, 'subtask.delete'));
    expect(await deleteAudits()).toBe(1);

    const replayed = await runOperation(as(owner), del);
    expect(replayed.revision).toBe(deleted.revision);
    expect(replayed.data).toEqual(deleted.data);
    expect(await deleteAudits()).toBe(1);

    // A refusal writes nothing: the note keeps its revision and no audit row is added.
    const audits = await ctx.db.$count(assistantAudit);
    const revisionNow = async () =>
      (
        (await runOperation(as(owner), call('get_note', { boardId, noteId }))).data as {
          revision: number;
        }
      ).revision;
    await expect(
      runOperation(
        as(owner),
        call('delete_subtask', { boardId, noteId, subtaskId, expectedRevision: 1 }),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'STALE_REVISION' });
    await expect(
      runOperation(
        as(owner),
        call('delete_subtask', {
          boardId,
          noteId,
          subtaskId: 'missing',
          expectedRevision: deleted.revision,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await revisionNow()).toBe(deleted.revision);
    expect(await ctx.db.$count(assistantAudit)).toBe(audits);
  });

  it('refuses a stale revision without applying anything', async () => {
    await fixture();
    const noteId = idOf(await create(owner, { title: 'x' }));
    await expect(
      runOperation(
        as(owner),
        call('update_note', { boardId, noteId, expectedRevision: 0, input: { title: 'y' } }),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'STALE_REVISION' });
    const detail = await runOperation(as(owner), call('get_note', { boardId, noteId }));
    expect(detail.data).toMatchObject({ title: 'x', revision: 1 });
  });

  it('binds every call to the context board', async () => {
    await fixture();
    registerTestUser(ctx, 'other-owner', 'other@fixture.de', 'Other');
    await createTestUser(ctx.db, 'other-owner', 'other@fixture.de', 'Other');
    const otherBoard = await createTestBoard(ctx.db, 'other-owner');
    const other: Actor = { id: 'other-owner', email: 'other@fixture.de', emailVerified: true };
    const foreign = idOf(
      await runOperation(
        as(other, { boardId: otherBoard }),
        call('create_note', { boardId: otherBoard, input: { title: 'theirs' } }),
      ),
    );

    await expect(
      runOperation(as(owner), call('get_note', { boardId, noteId: foreign })),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      runOperation(
        as(owner),
        call('complete_note', { boardId, noteId: foreign, expectedRevision: 1 }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      runOperation(as(owner), call('list_notes', { boardId: otherBoard })),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lets the command layer decide roles: a viewer keeps private notes, nothing else', async () => {
    await fixture();
    await expect(create(viewer, { title: 'shared' })).rejects.toMatchObject({ statusCode: 403 });
    const mine = await create(viewer, { title: 'mine', visibility: 'PRIVATE' });
    expect(mine.data).toMatchObject({ visibility: 'PRIVATE' });
    const updated = await runOperation(
      as(viewer),
      call('update_note', {
        boardId,
        noteId: idOf(mine),
        expectedRevision: 1,
        input: { title: 'still mine' },
      }),
    );
    expect(updated.revision).toBe(2);
    const list = await runOperation(as(viewer), call('list_notes', { boardId }));
    expect(list.data).toMatchObject({ total: 1 });
  });

  it('rejects unknown operations and invalid input before touching the board', async () => {
    await fixture();
    await expect(runOperation(as(owner), call('drop_board', { boardId }))).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      runOperation(as(owner), call('update_note', { boardId, noteId: 'n', input: { title: 'y' } })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      runOperation(
        as(owner),
        call('create_note', { boardId, input: { title: 'x' }, approvalId: 'spoof' }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('reuses the operation id on retry', async () => {
    await fixture();
    const op = call('create_note', { boardId, input: { title: 'once' } });
    const first = await runOperation(as(owner), op);
    const second = await runOperation(as(owner), op);
    expect(second.data).toEqual(first.data);
    const list = await runOperation(as(owner), call('list_notes', { boardId }));
    expect(list.data).toMatchObject({ total: 1 });
  });
});
