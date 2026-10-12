import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';
import {
  historyCol,
  membersCol,
  notesCol,
  now,
  shareLinksCol,
  subtasksCol,
  whiteboardsCol,
} from '../src/lib/db/collections.js';
import { executeBoardCommand } from '../src/lib/commands/index.js';
import { drainCleanup, reconcileBoards } from '../src/lib/commands/maintenance.js';

const projectId = 'wally-board-safety';
let ctx: TestContext;
let fx: Awaited<ReturnType<typeof createBoardFixture>>;
const headers = (revision?: number, key = randomUUID(), token = fx.ownerToken) => ({
  ...ctx.authHeader(token),
  'idempotency-key': key,
  ...(revision === undefined ? {} : { 'x-expected-revision': String(revision) }),
});
async function createNote() {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/whiteboards/${fx.boardId}/notes`,
    headers: headers(),
    payload: { title: 'Original' },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}
async function boardRevision() {
  return (
    await ctx.app.inject({
      method: 'GET',
      url: `/whiteboards/${fx.boardId}`,
      headers: ctx.authHeader(fx.ownerToken),
    })
  ).json().revision;
}

beforeAll(async () => {
  ctx = await buildTestApp(projectId);
});
beforeEach(async () => {
  await resetDatabase(projectId);
  fx = await createBoardFixture(ctx);
});
afterAll(async () => {
  await ctx.app.close();
});
afterEach(() => vi.restoreAllMocks());

describe('board safety contract', () => {
  it('validates direct commands and rejects a note from a different board', async () => {
    const note = await createNote();
    const actor = { id: fx.ownerId, email: 'owner@fixture.de', emailVerified: true };
    await expect(
      executeBoardCommand(
        ctx.db,
        actor,
        { type: 'note.update', noteId: note.id, boardId: 'wrong-board', input: { title: 'Wrong' } },
        { operationId: randomUUID(), expectedRevision: 1 },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      executeBoardCommand(
        ctx.db,
        actor,
        {
          type: 'note.update',
          noteId: note.id,
          input: { title: 'Wrong', assigneeId: fx.viewerId },
        },
        { operationId: randomUUID(), expectedRevision: 1 },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('retains a hidden deletion and durable cleanup job after cleanup failure', async () => {
    const note = await createNote();
    vi.spyOn(ctx.db, 'recursiveDelete').mockRejectedValueOnce(new Error('interrupted'));
    const request = { method: 'DELETE' as const, url: `/notes/${note.id}`, headers: headers(1) };
    expect((await ctx.app.inject(request)).statusCode).toBe(204);
    expect((await ctx.db.collection('boardCleanup').get()).size).toBe(1);
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/whiteboards/${fx.boardId}/notes`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(list.json()).toEqual([]);
    expect(
      (
        await ctx.app.inject({
          method: 'PATCH',
          url: `/notes/${note.id}`,
          headers: headers(2),
          payload: { title: 'Resurrect' },
        })
      ).statusCode,
    ).toBe(404);
    expect(await drainCleanup(ctx.db)).toEqual({ completed: 1, pending: 0 });
    expect((await notesCol(ctx.db).doc(note.id).get()).exists).toBe(false);
    expect((await ctx.app.inject(request)).statusCode).toBe(204);
  });

  it('legacy documents start at zero and their first mutation advances to one', async () => {
    const note = await createNote();
    const legacy = (await notesCol(ctx.db).doc(note.id).get()).data()!;
    delete legacy.revision;
    await notesCol(ctx.db).doc(note.id).set(legacy);
    const read = await ctx.app.inject({
      method: 'GET',
      url: `/notes/${note.id}`,
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(read.json().revision).toBe(0);
    const changed = await ctx.app.inject({
      method: 'PATCH',
      url: `/notes/${note.id}`,
      headers: headers(0),
      payload: { title: 'Versioned' },
    });
    expect(changed.json().revision).toBe(1);
  });

  it('does not clear an assignment changed after member removal committed', async () => {
    const note = await createNote();
    await notesCol(ctx.db).doc(note.id).update({ assigneeId: fx.editorId });
    const version = await boardRevision();
    const original = ctx.db.runTransaction.bind(ctx.db);
    let transactions = 0;
    vi.spyOn(ctx.db, 'runTransaction').mockImplementation((async (
      ...args: Parameters<typeof ctx.db.runTransaction>
    ) => {
      if (++transactions === 2)
        await notesCol(ctx.db).doc(note.id).update({ assigneeId: fx.ownerId, revision: 2 });
      return original(...args);
    }) as typeof ctx.db.runTransaction);
    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/whiteboards/${fx.boardId}/members/${fx.editMemberId}`,
      headers: headers(version),
    });
    expect(removed.statusCode).toBe(204);
    expect((await notesCol(ctx.db).doc(note.id).get()).data()).toMatchObject({
      assigneeId: fx.ownerId,
      revision: 2,
    });
  });

  it('bounds large duplication without leaving a partial note or receipt', async () => {
    const note = await createNote();
    const writer = ctx.db.bulkWriter();
    for (let i = 0; i < 401; i++)
      void writer.set(subtasksCol(ctx.db, note.id).doc(), {
        noteId: note.id,
        text: `Task ${i}`,
        done: false,
        sortIndex: i,
        createdAt: now(),
        updatedAt: now(),
      });
    await writer.close();
    const key = randomUUID();
    const copy = await ctx.app.inject({
      method: 'POST',
      url: `/notes/${note.id}/duplicate`,
      headers: headers(1, key),
      payload: {},
    });
    expect(copy.statusCode).toBe(422);
    expect(copy.json().error).toBe('COPY_TOO_LARGE');
    expect((await notesCol(ctx.db).get()).size).toBe(1);
    expect((await ctx.db.doc(`users/${fx.ownerId}/boardOperations/${key}`).get()).exists).toBe(
      false,
    );
  });

  it('reconciles role caches and orphan tokens only when explicitly applied', async () => {
    await whiteboardsCol(ctx.db)
      .doc(fx.boardId)
      .update({ memberRoles: { ghost: 'EDIT' } });
    await shareLinksCol(ctx.db)
      .doc('orphan')
      .set({ whiteboardId: fx.boardId, role: 'EDIT', createdAt: now(), updatedAt: now() });
    const report = await reconcileBoards(ctx.db);
    expect(report).toMatchObject({ roleCaches: 1, orphanLinks: 1 });
    expect((await shareLinksCol(ctx.db).doc('orphan').get()).exists).toBe(true);
    await reconcileBoards(ctx.db, true);
    expect((await whiteboardsCol(ctx.db).doc(fx.boardId).get()).data()?.memberRoles).toEqual({
      [fx.editorId]: 'EDIT',
      [fx.viewerId]: 'VIEW',
    });
    expect((await membersCol(ctx.db, fx.boardId).get()).size).toBe(2);
    expect((await shareLinksCol(ctx.db).doc('orphan').get()).exists).toBe(false);
  });
  it('requires operation IDs and revisions instead of accepting unprotected writes', async () => {
    const missingKey = await ctx.app.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/notes`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { title: 'Unsafe' },
    });
    expect(missingKey.statusCode).toBe(428);
    const note = await createNote();
    const missingVersion = await ctx.app.inject({
      method: 'PATCH',
      url: `/notes/${note.id}`,
      headers: headers(),
      payload: { title: 'Unsafe' },
    });
    expect(missingVersion.statusCode).toBe(428);
  });

  it('allows only one competing write from a revision, preserving the winner', async () => {
    const note = await createNote();
    expect(note.revision).toBe(1);
    const responses = await Promise.all(
      ['First', 'Second'].map((title) =>
        ctx.app.inject({
          method: 'PATCH',
          url: `/notes/${note.id}`,
          headers: headers(note.revision),
          payload: { title },
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find((r) => r.statusCode === 409)!.json().error).toBe('STALE_REVISION');
    const stored = (await notesCol(ctx.db).doc(note.id).get()).data()!;
    expect(stored.title).toBe(responses.find((r) => r.statusCode === 200)!.json().title);
    expect(stored).toMatchObject({ revision: 2 });
  });

  it('concurrent create retries commit one note and history and reject a changed payload', async () => {
    const key = randomUUID();
    const request = {
      method: 'POST' as const,
      url: `/whiteboards/${fx.boardId}/notes`,
      headers: headers(undefined, key),
      payload: { title: 'Once' },
    };
    const [a, b] = await Promise.all([ctx.app.inject(request), ctx.app.inject(request)]);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(a.json()).toEqual(b.json());
    expect((await notesCol(ctx.db).where('whiteboardId', '==', fx.boardId).get()).size).toBe(1);
    expect((await historyCol(ctx.db, a.json().id).get()).size).toBe(1);
    const changed = await ctx.app.inject({ ...request, payload: { title: 'Different' } });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('subtask text changes invalidate note edits and replay does not inflate counters', async () => {
    const note = await createNote();
    const request = {
      method: 'POST' as const,
      url: `/notes/${note.id}/subtasks`,
      headers: headers(1),
      payload: { text: 'Task' },
    };
    const added = await ctx.app.inject(request);
    expect(added.statusCode).toBe(201);
    expect(added.headers['x-resource-revision']).toBe('2');
    expect((await ctx.app.inject(request)).json()).toEqual(added.json());
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/notes/${note.id}/subtasks/${added.json().id}`,
      headers: headers(2),
      payload: { text: 'Edited' },
    });
    expect(edit.headers['x-resource-revision']).toBe('3');
    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/notes/${note.id}`,
      headers: headers(2),
      payload: { title: 'Lost update' },
    });
    expect(stale.statusCode).toBe(409);
    expect((await notesCol(ctx.db).doc(note.id).get()).data()).toMatchObject({
      revision: 3,
      subtaskSummary: { total: 1, done: 0 },
    });
  });

  it('replays deletion after physical cleanup and hides the deleted note', async () => {
    const note = await createNote();
    const request = { method: 'DELETE' as const, url: `/notes/${note.id}`, headers: headers(1) };
    expect((await ctx.app.inject(request)).statusCode).toBe(204);
    expect((await ctx.app.inject(request)).statusCode).toBe(204);
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/notes/${note.id}`,
          headers: ctx.authHeader(fx.ownerToken),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('replays a copy once but permits intentional independent copies', async () => {
    const note = await createNote();
    const request = {
      method: 'POST' as const,
      url: `/notes/${note.id}/duplicate`,
      headers: headers(1),
      payload: {},
    };
    const first = await ctx.app.inject(request);
    expect(first.statusCode).toBe(201);
    expect((await ctx.app.inject(request)).json().id).toBe(first.json().id);
    const second = await ctx.app.inject({ ...request, headers: headers(1) });
    expect(second.json().id).not.toBe(first.json().id);
  });

  it('checks current access before replaying a committed operation', async () => {
    const request = {
      method: 'POST' as const,
      url: `/whiteboards/${fx.boardId}/notes`,
      headers: headers(undefined, randomUUID(), fx.editToken),
      payload: { title: 'Private' },
    };
    expect((await ctx.app.inject(request)).statusCode).toBe(201);
    await whiteboardsCol(ctx.db).doc(fx.boardId).update({ memberRoles: {} });
    expect((await ctx.app.inject(request)).statusCode).toBe(404);
  });

  it('does not reset completedAt or revision for an already completed note', async () => {
    const note = await createNote();
    const complete = await ctx.app.inject({
      method: 'POST',
      url: `/notes/${note.id}/complete`,
      headers: headers(1),
    });
    const repeated = await ctx.app.inject({
      method: 'POST',
      url: `/notes/${note.id}/complete`,
      headers: headers(2),
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().completedAt).toBe(complete.json().completedAt);
    expect(repeated.json().revision).toBe(2);
  });

  it('serializes link creation and refuses orphan tokens', async () => {
    const revision = await boardRevision();
    const results = await Promise.all(
      [1, 2].map(() =>
        ctx.app.inject({
          method: 'POST',
          url: `/whiteboards/${fx.boardId}/share-link`,
          headers: headers(revision),
          payload: { role: 'VIEW' },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect((await shareLinksCol(ctx.db).where('whiteboardId', '==', fx.boardId).get()).size).toBe(
      1,
    );
    const link = (await shareLinksCol(ctx.db).get()).docs[0]!;
    await shareLinksCol(ctx.db).doc('orphan').set(link.data());
    const redeemed = await ctx.app.inject({
      method: 'POST',
      url: '/share-links/orphan/redeem',
      headers: headers(undefined, randomUUID(), fx.outsiderToken),
    });
    expect(redeemed.statusCode).toBe(404);
  });
});

it('rejects non-finite coordinates at the shared command boundary', async () => {
  const actor = { id: fx.ownerId, email: 'owner@fixture.de', emailVerified: true };
  await expect(
    executeBoardCommand(
      ctx.db,
      actor,
      { type: 'note.create', boardId: fx.boardId, input: { title: 'Invalid', freeX: Infinity } },
      { operationId: randomUUID() },
    ),
  ).rejects.toMatchObject({ statusCode: 400 });
  const note = await createNote();
  await expect(
    executeBoardCommand(
      ctx.db,
      actor,
      { type: 'note.duplicate', noteId: note.id, input: { freeY: -Infinity } },
      { operationId: randomUUID(), expectedRevision: 1 },
    ),
  ).rejects.toMatchObject({ statusCode: 400 });
});

it('serializes revocation racing a write and denies any later replay', async () => {
  const note = await createNote();
  const revision = await boardRevision();
  const edit = {
    method: 'PATCH' as const,
    url: `/notes/${note.id}`,
    headers: headers(1, randomUUID(), fx.editToken),
    payload: { title: 'Editor change' },
  };
  const [written, removed] = await Promise.all([
    ctx.app.inject(edit),
    ctx.app.inject({
      method: 'DELETE',
      url: `/whiteboards/${fx.boardId}/members/${fx.editMemberId}`,
      headers: headers(revision),
    }),
  ]);
  expect(removed.statusCode).toBe(204);
  expect([200, 404]).toContain(written.statusCode);
  expect((await ctx.app.inject(edit)).statusCode).toBe(404);
  expect((await notesCol(ctx.db).doc(note.id).get()).data()?.title).toBe(
    written.statusCode === 200 ? 'Editor change' : 'Original',
  );
});

it('serializes rotation racing redemption and rejects the old token afterward', async () => {
  const link = await ctx.app.inject({
    method: 'POST',
    url: `/whiteboards/${fx.boardId}/share-link`,
    headers: headers(await boardRevision()),
    payload: { role: 'VIEW' },
  });
  const revision = Number(link.headers['x-resource-revision']);
  const rotate = {
    method: 'POST' as const,
    url: `/whiteboards/${fx.boardId}/share-link/rotate`,
    headers: headers(revision),
    payload: {},
  };
  const [rotated, redeemed] = await Promise.all([
    ctx.app.inject(rotate),
    ctx.app.inject({
      method: 'POST',
      url: `/share-links/${link.json().token}/redeem`,
      headers: headers(undefined, randomUUID(), fx.outsiderToken),
    }),
  ]);
  expect([
    [200, 404],
    [409, 200],
  ]).toContainEqual([rotated.statusCode, redeemed.statusCode]);
  if (rotated.statusCode === 409)
    expect(
      (await ctx.app.inject({ ...rotate, headers: headers(await boardRevision()) })).statusCode,
    ).toBe(200);
  expect(
    (
      await ctx.app.inject({
        method: 'POST',
        url: `/share-links/${link.json().token}/redeem`,
        headers: headers(undefined, randomUUID(), fx.outsiderToken),
      })
    ).statusCode,
  ).toBe(404);
});

it('concurrent identical copies and subtasks commit each effect once', async () => {
  const note = await createNote();
  const taskRequest = {
    method: 'POST' as const,
    url: `/notes/${note.id}/subtasks`,
    headers: headers(1),
    payload: { text: 'Exactly once' },
  };
  const [taskA, taskB] = await Promise.all([
    ctx.app.inject(taskRequest),
    ctx.app.inject(taskRequest),
  ]);
  expect(taskA.statusCode).toBe(201);
  expect(taskB.json()).toEqual(taskA.json());
  expect((await subtasksCol(ctx.db, note.id).get()).size).toBe(1);
  const competing = await Promise.all(
    ['First', 'Second'].map((text) =>
      ctx.app.inject({
        method: 'PATCH',
        url: `/notes/${note.id}/subtasks/${taskA.json().id}`,
        headers: headers(2),
        payload: { text },
      }),
    ),
  );
  expect(competing.map((result) => result.statusCode).sort()).toEqual([200, 409]);
  const copyRequest = {
    method: 'POST' as const,
    url: `/notes/${note.id}/duplicate`,
    headers: headers(3),
    payload: {},
  };
  const [copyA, copyB] = await Promise.all([
    ctx.app.inject(copyRequest),
    ctx.app.inject(copyRequest),
  ]);
  expect(copyA.statusCode).toBe(201);
  expect(copyB.json()).toEqual(copyA.json());
  expect((await notesCol(ctx.db).get()).size).toBe(2);
  expect((await subtasksCol(ctx.db, copyA.json().id).get()).size).toBe(1);
  expect((await historyCol(ctx.db, copyA.json().id).get()).size).toBe(1);
});

it('preserves assignments when a removed member regains access before cleanup', async () => {
  const note = await createNote();
  await notesCol(ctx.db).doc(note.id).update({ assigneeId: fx.editorId });
  const revision = await boardRevision();
  const run = ctx.db.runTransaction.bind(ctx.db);
  let calls = 0;
  vi.spyOn(ctx.db, 'runTransaction').mockImplementation((async (
    ...args: Parameters<typeof ctx.db.runTransaction>
  ) => {
    if (++calls === 2) {
      const batch = ctx.db.batch();
      batch.set(membersCol(ctx.db, fx.boardId).doc(fx.editMemberId), {
        whiteboardId: fx.boardId,
        userId: fx.editorId,
        role: 'EDIT',
        status: 'ACTIVE',
        invitedEmail: null,
        invitedAt: now(),
        activatedAt: now(),
      });
      batch.update(whiteboardsCol(ctx.db).doc(fx.boardId), {
        [`memberRoles.${fx.editorId}`]: 'EDIT',
        revision: revision + 2,
      });
      await batch.commit();
    }
    return run(...args);
  }) as typeof ctx.db.runTransaction);
  expect(
    (
      await ctx.app.inject({
        method: 'DELETE',
        url: `/whiteboards/${fx.boardId}/members/${fx.editMemberId}`,
        headers: headers(revision),
      })
    ).statusCode,
  ).toBe(204);
  expect((await notesCol(ctx.db).doc(note.id).get()).data()).toMatchObject({
    assigneeId: fx.editorId,
    revision: 1,
  });
});
