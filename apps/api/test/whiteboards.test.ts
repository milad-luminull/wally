import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { whiteboardsCol } from '../src/lib/db/collections.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-whiteboards';

describe('whiteboard routes', () => {
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

  describe('GET /whiteboards/:id', () => {
    it('200s for the owner', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().currentUserRole).toBe('OWNER');
    });

    it('reports the assistant switch on the board response, off by default', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().assistantEnabled).toBe(false);
    });

    it('200s for an active EDIT member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.editToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().currentUserRole).toBe('EDIT');
    });

    it('200s for an active VIEW member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.viewToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().currentUserRole).toBe('VIEW');
    });

    it('404s for a non-member (never reveals existence)', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it('404s for a nonexistent whiteboard id', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/does-not-exist`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /whiteboards/:id (owner-only rename)', () => {
    it('200s and renames for the owner', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { name: 'Neuer Name' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Neuer Name');
    });

    it('replays a receipt written before assistantEnabled existed, reading it as false', async () => {
      const fx = await createBoardFixture(ctx);
      const revision = (await whiteboardsCol(ctx.db).doc(fx.boardId).get()).data()?.revision ?? 0;
      const request = {
        method: 'PATCH' as const,
        url: `/whiteboards/${fx.boardId}`,
        headers: {
          ...ctx.authHeader(fx.ownerToken),
          'idempotency-key': randomUUID(),
          'x-expected-revision': String(revision),
        },
        payload: { name: 'Neuer Name' },
      };
      const first = await ctx.inject(request);
      expect(first.statusCode).toBe(200);

      // Make the stored receipt look like one written before this deploy.
      await ctx.db
        .doc(`users/${fx.ownerId}/boardOperations/${request.headers['idempotency-key']}`)
        .update({ 'result.data.assistantEnabled': FieldValue.delete() });

      const replay = await ctx.inject(request);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ name: 'Neuer Name', assistantEnabled: false });
    });

    it('403s for an EDIT member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.editToken),
        payload: { name: 'Nope' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('403s for a VIEW member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.viewToken),
        payload: { name: 'Nope' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('404s for a non-member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}`,
        headers: ctx.authHeader(fx.outsiderToken),
        payload: { name: 'Nope' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /whiteboards/:id/assistant (owner-only switch)', () => {
    it('lets the owner switch the assistant off and on again, storing only the flag', async () => {
      const fx = await createBoardFixture(ctx);
      const off = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}/assistant`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { enabled: false },
      });
      expect(off.statusCode).toBe(200);
      expect(off.json().assistantEnabled).toBe(false);
      expect((await whiteboardsCol(ctx.db).doc(fx.boardId).get()).data()?.assistantDisabled).toBe(
        true,
      );
      const revisionAfterOff = off.json().revision;

      const on = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}/assistant`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { enabled: true },
      });
      expect(on.statusCode).toBe(200);
      expect(on.json().revision).toBe(revisionAfterOff + 1);
      expect((await whiteboardsCol(ctx.db).doc(fx.boardId).get()).data()?.assistantDisabled).toBe(
        false,
      );
    });

    it('is a no-op when the value does not change', async () => {
      const fx = await createBoardFixture(ctx);
      const before = (
        await ctx.inject({
          method: 'GET',
          url: `/whiteboards/${fx.boardId}`,
          headers: ctx.authHeader(fx.ownerToken),
        })
      ).json().revision;
      const res = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}/assistant`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { enabled: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().revision).toBe(before);
    });

    it('is refused for editors, viewers and outsiders', async () => {
      const fx = await createBoardFixture(ctx);
      for (const [token, status] of [
        [fx.editToken, 403],
        [fx.viewToken, 403],
        [fx.outsiderToken, 404],
      ] as const) {
        const res = await ctx.inject({
          method: 'PATCH',
          url: `/whiteboards/${fx.boardId}/assistant`,
          headers: ctx.authHeader(token),
          payload: { enabled: false },
        });
        expect(res.statusCode).toBe(status);
      }
      expect((await whiteboardsCol(ctx.db).doc(fx.boardId).get()).data()).not.toHaveProperty(
        'assistantDisabled',
      );
    });

    it('rejects a body without a boolean', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}/assistant`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { enabled: 'no' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /whiteboards/:id/members', () => {
    it('200s for owner, EDIT, and VIEW; 404 for non-member', async () => {
      const fx = await createBoardFixture(ctx);
      for (const token of [fx.ownerToken, fx.editToken, fx.viewToken]) {
        const res = await ctx.inject({
          method: 'GET',
          url: `/whiteboards/${fx.boardId}/members`,
          headers: ctx.authHeader(token),
        });
        expect(res.statusCode).toBe(200);
        // Two stored member rows plus the synthetic owner row.
        expect(res.json()).toHaveLength(3);
      }
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/members`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it('includes the owner first, so a note can be assigned to them', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/members`,
        headers: ctx.authHeader(fx.ownerToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()[0]).toMatchObject({
        id: `owner:${fx.ownerId}`,
        userId: fx.ownerId,
        role: 'OWNER',
        status: 'ACTIVE',
      });
      // The owner has no member document, so their row must not be editable or removable.
      for (const method of ['PATCH', 'DELETE'] as const) {
        const denied = await ctx.inject({
          method,
          url: `/whiteboards/${fx.boardId}/members/owner:${fx.ownerId}`,
          headers: ctx.authHeader(fx.ownerToken),
          ...(method === 'PATCH' ? { payload: { role: 'VIEW' } } : {}),
        });
        expect(denied.statusCode).toBe(404);
      }
    });
  });

  describe('GET /whiteboards/:id/tags', () => {
    it('returns distinct tags in use, and 404s for a non-member', async () => {
      const fx = await createBoardFixture(ctx);
      for (const payload of [
        { title: 'A', tags: ['Cyber', 'Review'] },
        { title: 'B', tags: ['Cyber'] },
      ]) {
        await ctx.inject({
          method: 'POST',
          url: `/whiteboards/${fx.boardId}/notes`,
          headers: ctx.authHeader(fx.ownerToken),
          payload,
        });
      }

      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/tags`,
        headers: ctx.authHeader(fx.viewToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().sort()).toEqual(['Cyber', 'Review']);

      const forbidden = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/tags`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(forbidden.statusCode).toBe(404);
    });

    it("sorts tags in the caller's profile language", async () => {
      const fx = await createBoardFixture(ctx);
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { title: 'Tagged', tags: ['Zebra', 'Ärger', 'apple'] },
      });
      // The viewer reads in English; the owner keeps the default German profile.
      const switched = await ctx.inject({
        method: 'PATCH',
        url: '/me',
        headers: ctx.authHeader(fx.viewToken),
        payload: { language: 'en' },
      });
      expect(switched.statusCode).toBe(200);

      const compare = vi.spyOn(String.prototype, 'localeCompare');
      const tagsFor = async (token: string) => {
        compare.mockClear();
        const res = await ctx.inject({
          method: 'GET',
          url: `/whiteboards/${fx.boardId}/tags`,
          headers: ctx.authHeader(token),
        });
        expect(res.statusCode).toBe(200);
        return { tags: res.json(), locales: compare.mock.calls.map(([, locale]) => locale) };
      };

      try {
        // Both orders are a reader's order, not code points (which would put Zebra before Ärger).
        const english = await tagsFor(fx.viewToken);
        expect(english.tags).toEqual(['apple', 'Ärger', 'Zebra']);
        expect(english.locales).toContain('en');
        expect(english.locales).not.toContain('de');

        const german = await tagsFor(fx.ownerToken);
        expect(german.tags).toEqual(['apple', 'Ärger', 'Zebra']);
        expect(german.locales).toContain('de');
        expect(german.locales).not.toContain('en');
      } finally {
        compare.mockRestore();
      }
    });
  });

  describe('GET /whiteboards (caller list)', () => {
    it('lists boards owned or actively membered by the caller', async () => {
      const fx = await createBoardFixture(ctx);

      const ownerRes = await ctx.inject({
        method: 'GET',
        url: '/whiteboards',
        headers: ctx.authHeader(fx.ownerToken),
      });
      const ownerBoards = ownerRes.json();
      expect(ownerBoards.some((b: { id: string }) => b.id === fx.boardId)).toBe(true);

      const editRes = await ctx.inject({
        method: 'GET',
        url: '/whiteboards',
        headers: ctx.authHeader(fx.editToken),
      });
      const editBoards = editRes.json();
      const membered = editBoards.find((b: { id: string }) => b.id === fx.boardId);
      expect(membered.currentUserRole).toBe('EDIT');
    });
  });
  // RFC BOARD_HOME §12.2: from the moment board.delete commits, the board reads as absent for
  // everyone, exactly like a board the caller was never a member of.
  describe('a tombstoned board', () => {
    async function tombstoned() {
      const fx = await createBoardFixture(ctx);
      await whiteboardsCol(ctx.db).doc(fx.boardId).update({ deletedAt: Timestamp.now() });
      return fx;
    }

    it('is absent from the owner’s and a member’s board list', async () => {
      const fx = await tombstoned();
      for (const token of [fx.ownerToken, fx.editToken]) {
        const res = await ctx.inject({
          method: 'GET',
          url: '/whiteboards',
          headers: ctx.authHeader(token),
        });
        // Each fixture user also owns their own provisioned board; only this one must go.
        expect(res.json().map((b: { id: string }) => b.id)).not.toContain(fx.boardId);
      }
    });

    it('reads as 404 for the owner, exactly like a board that never existed', async () => {
      const fx = await tombstoned();
      const headers = ctx.authHeader(fx.ownerToken);
      const get = await ctx.inject({ method: 'GET', url: `/whiteboards/${fx.boardId}`, headers });
      expect(get.statusCode).toBe(404);
      const notes = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers,
      });
      expect(notes.statusCode).toBe(404);
      const rename = await ctx.inject({
        method: 'PATCH',
        url: `/whiteboards/${fx.boardId}`,
        headers,
        payload: { name: 'Nope' },
      });
      expect(rename.statusCode).toBe(404);
      const note = await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers,
        payload: { title: 'Nope' },
      });
      expect(note.statusCode).toBe(404);
    });
  });
});
