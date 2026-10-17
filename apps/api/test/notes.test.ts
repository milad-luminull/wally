import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { MAX_FIELDS_PER_NOTE, MAX_TAGS_PER_NOTE } from '@wally/shared';
import {
  docsWithId,
  historyCol,
  notesCol,
  subtasksCol,
  withId,
} from '../src/lib/db/collections.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';
import { listNotes } from '../src/lib/commands/queries.js';

const PROJECT_ID = 'wally-test-notes-routes';

describe('note routes', () => {
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

  async function createNote(
    boardId: string,
    token: string,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/notes`,
      headers: ctx.authHeader(token),
      payload: { title: 'Test note', ...overrides },
    });
    return res;
  }

  describe('GET /whiteboards/:id/notes', () => {
    it('preserves priority, horizon and assignment filters through HTTP and direct queries', async () => {
      const fx = await createBoardFixture(ctx);
      for (const input of [
        { title: 'Match', priority: 'HOCH', horizon: 'HEUTE', assigneeId: fx.ownerId },
        { title: 'Other priority', priority: 'NIEDRIG', horizon: 'HEUTE', assigneeId: fx.ownerId },
        { title: 'Other horizon', priority: 'HOCH', horizon: 'SPAETER', assigneeId: fx.ownerId },
        { title: 'Other assignee', priority: 'HOCH', horizon: 'HEUTE', assigneeId: fx.editorId },
      ]) {
        expect((await createNote(fx.boardId, fx.ownerToken, input)).statusCode).toBe(201);
      }

      for (const [query, titles] of [
        ['priority=HOCH', ['Match', 'Other assignee', 'Other horizon']],
        ['horizon=HEUTE', ['Match', 'Other assignee', 'Other priority']],
        ['assignedToMe=true', ['Match', 'Other horizon', 'Other priority']],
        ['priority=HOCH&horizon=HEUTE&assignedToMe=true', ['Match']],
        [
          'priority=HOCH,NIEDRIG&horizon=HEUTE&assignedToMe=false',
          ['Match', 'Other assignee', 'Other priority'],
        ],
      ] as const) {
        const res = await ctx.inject({
          method: 'GET',
          url: `/whiteboards/${fx.boardId}/notes?${query}`,
          headers: ctx.authHeader(fx.ownerToken),
        });
        expect(res.statusCode).toBe(200);
        expect(
          res
            .json()
            .map((note: { title: string }) => note.title)
            .sort(),
        ).toEqual(titles);
      }

      const actor = { id: fx.ownerId, email: 'owner@fixture.de', emailVerified: true };
      const notes = await listNotes(ctx.db, actor, fx.boardId, {
        priority: ['HOCH'],
        horizon: ['HEUTE'],
        assignedToMe: true,
      });
      expect(notes.map((note) => note.title)).toEqual(['Match']);
    });

    it('rejects malformed filters instead of treating them as an unfiltered query', async () => {
      const fx = await createBoardFixture(ctx);
      const actor = { id: fx.ownerId, email: 'owner@fixture.de', emailVerified: true };
      for (const query of [{ priority: ['INVALID'] }, { horizon: 123 }, { assignedToMe: 'yes' }]) {
        await expect(listNotes(ctx.db, actor, fx.boardId, query)).rejects.toThrow();
      }
      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes?assignedToMe=yes`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(400);
    });

    it('200s for owner/EDIT/VIEW, 404s for a non-member', async () => {
      const fx = await createBoardFixture(ctx);
      await createNote(fx.boardId, fx.ownerToken);

      for (const token of [fx.ownerToken, fx.editToken, fx.viewToken]) {
        const res = await ctx.inject({
          method: 'GET',
          url: `/whiteboards/${fx.boardId}/notes`,
          headers: ctx.authHeader(token),
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toHaveLength(1);
      }

      const forbidden = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(forbidden.statusCode).toBe(404);
    });

    it('q filter matches title, description, custom fields, and tags, case-insensitively', async () => {
      const fx = await createBoardFixture(ctx);
      await createNote(fx.boardId, fx.ownerToken, { title: 'Check the cyber policy' });
      await createNote(fx.boardId, fx.ownerToken, {
        title: 'Irrelevant',
        customFields: { Contract: 'Cyber Package Plus' },
      });
      await createNote(fx.boardId, fx.ownerToken, { title: 'Irrelevant', tags: ['cyber'] });
      await createNote(fx.boardId, fx.ownerToken, {
        title: 'Irrelevant',
        description: 'Get a quote for the cyber cover',
      });
      await createNote(fx.boardId, fx.ownerToken, { title: 'Something else entirely' });

      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes?q=CYBER`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(4);
    });

    it('field filter matches by key alone and by key:value, case-insensitively', async () => {
      const fx = await createBoardFixture(ctx);
      await createNote(fx.boardId, fx.ownerToken, {
        title: 'A',
        customFields: { Customer: 'Müller GmbH' },
      });
      await createNote(fx.boardId, fx.ownerToken, {
        title: 'B',
        customFields: { Customer: 'Steiner AG' },
      });
      await createNote(fx.boardId, fx.ownerToken, {
        title: 'C',
        customFields: { 'Contract number': '4711' },
      });
      await createNote(fx.boardId, fx.ownerToken, { title: 'D' });

      const byKey = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes?field=${encodeURIComponent('customer')}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(byKey.json()).toHaveLength(2);

      const byPair = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes?field=${encodeURIComponent('Customer:müller gmbh')}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(byPair.json()).toHaveLength(1);
      expect(byPair.json()[0].title).toBe('A');
    });

    it('field filter folds case without a locale: CUSTOMER finds Customer, STRASSE does not find Straße', async () => {
      const fx = await createBoardFixture(ctx);
      await createNote(fx.boardId, fx.ownerToken, {
        title: 'Customer',
        customFields: { Customer: 'Müller GmbH' },
      });
      await createNote(fx.boardId, fx.ownerToken, {
        title: 'Street',
        customFields: { Straße: 'Hauptweg 1' },
      });

      const titles = async (field: string) => {
        const res = await ctx.inject({
          method: 'GET',
          url: `/whiteboards/${fx.boardId}/notes?field=${encodeURIComponent(field)}`,
          headers: ctx.authHeader(fx.ownerToken),
        });
        expect(res.statusCode).toBe(200);
        return res.json().map((n: { title: string }) => n.title);
      };

      expect(await titles('CUSTOMER')).toEqual(['Customer']);
      expect(await titles('CUSTOMER:MÜLLER GMBH')).toEqual(['Customer']);
      expect(await titles('straße')).toEqual(['Street']);
      expect(await titles('STRASSE')).toEqual([]);
    });

    it('orders by due date, with undated notes last and none dropped', async () => {
      // Firestore sorts null first and omits documents missing the ordered field
      // entirely, so this ordering is done in memory. Both halves matter: an undated note
      // must come last AND must still be in the list at all.
      const fx = await createBoardFixture(ctx);
      await createNote(fx.boardId, fx.ownerToken, { title: 'No date' });
      await createNote(fx.boardId, fx.ownerToken, { title: 'Late', dueDate: '2027-01-31' });
      await createNote(fx.boardId, fx.ownerToken, { title: 'Early', dueDate: '2026-01-31' });

      const res = await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((n: { title: string }) => n.title)).toEqual([
        'Early',
        'Late',
        'No date',
      ]);
    });
  });

  describe('POST /whiteboards/:id/notes (create)', () => {
    it('201s for owner and EDIT, and writes a CREATED history event', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await createNote(fx.boardId, fx.editToken, { title: 'New note' });
      expect(res.statusCode).toBe(201);
      const note = res.json();

      const detail = await ctx.inject({
        method: 'GET',
        url: `/notes/${note.id}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      const history = detail.json().history;
      expect(history).toHaveLength(1);
      expect(history[0].type).toBe('CREATED');
    });

    it('403s for a VIEW member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await createNote(fx.boardId, fx.viewToken);
      expect(res.statusCode).toBe(403);
    });

    it('404s for a non-member', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await createNote(fx.boardId, fx.outsiderToken);
      expect(res.statusCode).toBe(404);
    });

    it('422s with INVALID_ASSIGNEE for a non-member assignee', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await createNote(fx.boardId, fx.ownerToken, { assigneeId: 'fx-outsider' });
      expect(res.statusCode).toBe(422);
    });

    it.each(['constructor', 'toString', '__proto__'])(
      'rejects inherited membership key %s on create and assignment',
      async (assigneeId) => {
        const fx = await createBoardFixture(ctx);
        const invalidCreate = await createNote(fx.boardId, fx.ownerToken, { assigneeId });
        expect(invalidCreate.statusCode).toBe(422);
        expect(invalidCreate.json().error).toBe('INVALID_ASSIGNEE');
        expect((await notesCol(ctx.db).get()).size).toBe(0);

        const created = (
          await createNote(fx.boardId, fx.ownerToken, { assigneeId: fx.editorId })
        ).json();
        const invalidAssign = await ctx.inject({
          method: 'POST',
          url: `/notes/${created.id}/assign`,
          headers: ctx.authHeader(fx.ownerToken),
          payload: { assigneeId },
        });
        expect(invalidAssign.statusCode).toBe(422);
        expect(invalidAssign.json().error).toBe('INVALID_ASSIGNEE');
        expect((await notesCol(ctx.db).doc(created.id).get()).data()).toMatchObject({
          assigneeId: fx.editorId,
          revision: created.revision,
        });
      },
    );

    it('persists custom fields, and defaults them to {} when omitted', async () => {
      const fx = await createBoardFixture(ctx);

      const withFields = await createNote(fx.boardId, fx.ownerToken, {
        customFields: { Customer: 'Müller GmbH', 'Contract number': '4711' },
      });
      expect(withFields.statusCode).toBe(201);
      expect(withFields.json().customFields).toEqual({
        Customer: 'Müller GmbH',
        'Contract number': '4711',
      });

      const without = await createNote(fx.boardId, fx.ownerToken);
      expect(without.json().customFields).toEqual({});
    });

    it('persists a description, and defaults it to an empty string', async () => {
      const fx = await createBoardFixture(ctx);
      const withText = await createNote(fx.boardId, fx.ownerToken, {
        description: 'First line\nsecond line',
      });
      expect(withText.json().description).toBe('First line\nsecond line');

      const without = await createNote(fx.boardId, fx.ownerToken);
      expect(without.json().description).toBe('');
    });

    it('reads a note stored before descriptions existed as an empty description', async () => {
      const fx = await createBoardFixture(ctx);
      const created = await createNote(fx.boardId, fx.ownerToken);
      const id = created.json().id as string;
      await notesCol(ctx.db).doc(id).update({ description: FieldValue.delete() });

      const res = await ctx.inject({
        method: 'GET',
        url: `/notes/${id}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().description).toBe('');
    });

    it('400s on custom fields that break the key rules or the per-note cap', async () => {
      const fx = await createBoardFixture(ctx);
      const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`Feld${i}`, 'x']));

      for (const customFields of [
        tooMany,
        { Customer: 'A', customer: 'B' }, // same property in two casings
        { 'Customer.Name': 'A' }, // Firestore field-path metacharacter
        { [`${'k'.repeat(41)}`]: 'A' }, // key over FIELD_KEY_MAX_LENGTH
        { Customer: 'v'.repeat(201) }, // value over FIELD_VALUE_MAX_LENGTH
      ]) {
        const res = await createNote(fx.boardId, fx.ownerToken, { customFields });
        expect(res.statusCode).toBe(400);
      }
    });
  });

  describe('note-scoped mutation routes (PATCH/move/assign/complete/reopen/delete)', () => {
    async function setup() {
      const fx = await createBoardFixture(ctx);
      const created = await createNote(fx.boardId, fx.ownerToken);
      return { fx, noteId: created.json().id as string };
    }

    it('PATCH /notes/:id — 200 for EDIT, 403 for VIEW, 404 for non-member', async () => {
      const { fx, noteId } = await setup();
      const ok = await ctx.inject({
        method: 'PATCH',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.editToken),
        payload: { title: 'Changed' },
      });
      expect(ok.statusCode).toBe(200);

      const forbidden = await ctx.inject({
        method: 'PATCH',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.viewToken),
        payload: { title: 'Nope' },
      });
      expect(forbidden.statusCode).toBe(403);

      const notFound = await ctx.inject({
        method: 'PATCH',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.outsiderToken),
        payload: { title: 'Nope' },
      });
      expect(notFound.statusCode).toBe(404);
    });

    it('PATCH customFields: omitted leaves them alone, {} clears them', async () => {
      const { fx, noteId } = await setup();

      const patch = (payload: Record<string, unknown>) =>
        ctx.inject({
          method: 'PATCH',
          url: `/notes/${noteId}`,
          headers: ctx.authHeader(fx.ownerToken),
          payload,
        });

      const set = await patch({ customFields: { Customer: 'Müller GmbH' } });
      expect(set.json().customFields).toEqual({ Customer: 'Müller GmbH' });

      // Touching an unrelated field must not disturb them.
      const untouched = await patch({ title: 'Another title' });
      expect(untouched.json().customFields).toEqual({ Customer: 'Müller GmbH' });

      const cleared = await patch({ customFields: {} });
      expect(cleared.json().customFields).toEqual({});
    });

    describe('PATCH fieldChanges / tagChanges', () => {
      const patchAs = (token: string, noteId: string, payload: Record<string, unknown>) =>
        ctx.inject({
          method: 'PATCH',
          url: `/notes/${noteId}`,
          headers: ctx.authHeader(token),
          payload,
        });

      it('keeps property deltas after the stale editor reviews and resubmits', async () => {
        const { fx, noteId } = await setup();

        const [a, b] = await Promise.all([
          patchAs(fx.ownerToken, noteId, { fieldChanges: { set: { Customer: 'Müller GmbH' } } }),
          patchAs(fx.editToken, noteId, { fieldChanges: { set: { Contract: '4711' } } }),
        ]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
        const retry =
          a.statusCode === 409
            ? await patchAs(fx.ownerToken, noteId, {
                fieldChanges: { set: { Customer: 'Müller GmbH' } },
              })
            : await patchAs(fx.editToken, noteId, { fieldChanges: { set: { Contract: '4711' } } });
        expect(retry.statusCode).toBe(200);

        const stored = withId(await notesCol(ctx.db).doc(noteId).get());
        expect(stored?.customFields).toEqual({ Customer: 'Müller GmbH', Contract: '4711' });
      });

      it('keeps tag deltas after the stale editor reviews and resubmits', async () => {
        const { fx, noteId } = await setup();

        const [a, b] = await Promise.all([
          patchAs(fx.ownerToken, noteId, { tagChanges: { add: ['cyber'] } }),
          patchAs(fx.editToken, noteId, { tagChanges: { add: ['d&o'] } }),
        ]);

        expect([a!.statusCode, b!.statusCode].sort()).toEqual([200, 409]);
        expect(
          (
            await patchAs(a!.statusCode === 409 ? fx.ownerToken : fx.editToken, noteId, {
              tagChanges: { add: [a!.statusCode === 409 ? 'cyber' : 'd&o'] },
            })
          ).statusCode,
        ).toBe(200);
        const stored = withId(await notesCol(ctx.db).doc(noteId).get());
        expect([...(stored?.tags ?? [])].sort()).toEqual(['cyber', 'd&o']);
      });

      it('resolves set and remove against existing keys case-insensitively', async () => {
        const { fx, noteId } = await setup();
        await patchAs(fx.ownerToken, noteId, { customFields: { Customer: 'Old', Contract: 'X' } });

        const set = await patchAs(fx.ownerToken, noteId, {
          fieldChanges: { set: { customer: 'New' } },
        });
        expect(set.json().customFields).toEqual({ Customer: 'New', Contract: 'X' });

        const removed = await patchAs(fx.ownerToken, noteId, {
          fieldChanges: { remove: ['CONTRACT'] },
        });
        expect(removed.json().customFields).toEqual({ Customer: 'New' });
      });

      it('adds a tag once, and removes it', async () => {
        const { fx, noteId } = await setup();
        await patchAs(fx.ownerToken, noteId, { tagChanges: { add: ['cyber'] } });
        const twice = await patchAs(fx.ownerToken, noteId, { tagChanges: { add: ['cyber'] } });
        expect(twice.json().tags).toEqual(['cyber']);

        const removed = await patchAs(fx.ownerToken, noteId, { tagChanges: { remove: ['cyber'] } });
        expect(removed.json().tags).toEqual([]);
      });

      it('400s when the merged result goes over the limit', async () => {
        const { fx, noteId } = await setup();
        const full = Object.fromEntries(
          Array.from({ length: MAX_FIELDS_PER_NOTE }, (_, i) => [`Field ${i}`, 'x']),
        );
        await patchAs(fx.ownerToken, noteId, { customFields: full });

        const over = await patchAs(fx.ownerToken, noteId, {
          fieldChanges: { set: { Extra: 'x' } },
        });
        expect(over.statusCode).toBe(400);

        const tags = Array.from({ length: MAX_TAGS_PER_NOTE }, (_, i) => `t${i}`);
        await patchAs(fx.ownerToken, noteId, { tags });
        const overTags = await patchAs(fx.ownerToken, noteId, { tagChanges: { add: ['extra'] } });
        expect(overTags.statusCode).toBe(400);
      });

      it('400s when a replace and a change target the same attribute', async () => {
        const { fx, noteId } = await setup();
        const fields = await patchAs(fx.ownerToken, noteId, {
          customFields: {},
          fieldChanges: { set: { Customer: 'x' } },
        });
        expect(fields.statusCode).toBe(400);

        const tags = await patchAs(fx.ownerToken, noteId, {
          tags: [],
          tagChanges: { add: ['x'] },
        });
        expect(tags.statusCode).toBe(400);
      });
    });

    it('PATCH description: sets it, and an empty string clears it', async () => {
      const { fx, noteId } = await setup();
      const patch = (payload: Record<string, unknown>) =>
        ctx.inject({
          method: 'PATCH',
          url: `/notes/${noteId}`,
          headers: ctx.authHeader(fx.editToken),
          payload,
        });

      expect((await patch({ description: 'Noted briefly' })).json().description).toBe(
        'Noted briefly',
      );
      expect((await patch({ title: 'Another title' })).json().description).toBe('Noted briefly');
      expect((await patch({ description: '' })).json().description).toBe('');
    });

    it('POST /notes/:id/move — HORIZON mode leaves priority/freeX/freeY untouched', async () => {
      const { fx, noteId } = await setup();
      const before = await ctx.inject({
        method: 'GET',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      const beforeNote = before.json();

      const res = await ctx.inject({
        method: 'POST',
        url: `/notes/${noteId}/move`,
        headers: ctx.authHeader(fx.editToken),
        payload: { mode: 'HORIZON', horizon: 'SPAETER' },
      });
      expect(res.statusCode).toBe(200);
      const after = res.json();

      expect(after.horizon).toBe('SPAETER');
      expect(after.priority).toBe(beforeNote.priority);
      expect(after.freeX).toBe(beforeNote.freeX);
      expect(after.freeY).toBe(beforeNote.freeY);

      const detail = await ctx.inject({
        method: 'GET',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      const moved = detail.json().history.find((h: { type: string }) => h.type === 'MOVED');
      expect(moved.metadata).toEqual({ mode: 'HORIZON', from: 'HEUTE', to: 'SPAETER' });
    });

    it('POST /notes/:id/move — 403 for VIEW, 404 for non-member', async () => {
      const { fx, noteId } = await setup();
      const forbidden = await ctx.inject({
        method: 'POST',
        url: `/notes/${noteId}/move`,
        headers: ctx.authHeader(fx.viewToken),
        payload: { mode: 'PRIORITY', priority: 'HOCH' },
      });
      expect(forbidden.statusCode).toBe(403);

      const notFound = await ctx.inject({
        method: 'POST',
        url: `/notes/${noteId}/move`,
        headers: ctx.authHeader(fx.outsiderToken),
        payload: { mode: 'PRIORITY', priority: 'HOCH' },
      });
      expect(notFound.statusCode).toBe(404);
    });

    it('POST /notes/:id/assign — 200 for a valid active member, 422 for a non-member', async () => {
      const { fx, noteId } = await setup();
      const ok = await ctx.inject({
        method: 'POST',
        url: `/notes/${noteId}/assign`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { assigneeId: fx.editorId },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().assignee.id).toBe(fx.editorId);

      const invalid = await ctx.inject({
        method: 'POST',
        url: `/notes/${noteId}/assign`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { assigneeId: 'not-a-member-id' },
      });
      expect(invalid.statusCode).toBe(422);
      expect(invalid.json().error).toBe('INVALID_ASSIGNEE');
    });

    it('POST /notes/:id/complete then /reopen round-trips status', async () => {
      const { fx, noteId } = await setup();
      const completed = await ctx.inject({
        method: 'POST',
        url: `/notes/${noteId}/complete`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(completed.statusCode).toBe(200);
      expect(completed.json().status).toBe('DONE');
      expect(completed.json().completedAt).not.toBeNull();

      const reopened = await ctx.inject({
        method: 'POST',
        url: `/notes/${noteId}/reopen`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(reopened.statusCode).toBe(200);
      expect(reopened.json().status).toBe('OPEN');
      expect(reopened.json().completedAt).toBeNull();
    });

    it('DELETE /notes/:id — 204 for EDIT, 403 for VIEW, 404 for non-member', async () => {
      const { fx, noteId } = await setup();

      const forbidden = await ctx.inject({
        method: 'DELETE',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.viewToken),
      });
      expect(forbidden.statusCode).toBe(403);

      const notFound = await ctx.inject({
        method: 'DELETE',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(notFound.statusCode).toBe(404);

      const ok = await ctx.inject({
        method: 'DELETE',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.editToken),
      });
      expect(ok.statusCode).toBe(204);

      const gone = withId(await notesCol(ctx.db).doc(noteId).get());
      expect(gone).toBeNull();
    });

    it("DELETE /notes/:id takes the note's subtasks and history with it", async () => {
      // Firestore does not delete subcollections when their parent document goes, and
      // there are no foreign keys left to cascade — the route has to do this by hand.
      const { fx, noteId } = await setup();
      await ctx.inject({
        method: 'POST',
        url: `/notes/${noteId}/subtasks`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { text: 'Hangs on the note' },
      });
      expect((await subtasksCol(ctx.db, noteId).get()).size).toBe(1);
      expect((await historyCol(ctx.db, noteId).get()).size).toBe(1); // the CREATED event

      const deleted = await ctx.inject({
        method: 'DELETE',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(deleted.statusCode).toBe(204);

      expect((await subtasksCol(ctx.db, noteId).get()).size).toBe(0);
      expect((await historyCol(ctx.db, noteId).get()).size).toBe(0);
    });
  });

  describe('POST /notes/:id/duplicate', () => {
    function duplicate(noteId: string, token: string, payload: Record<string, unknown> = {}) {
      return ctx.inject({
        method: 'POST',
        url: `/notes/${noteId}/duplicate`,
        headers: ctx.authHeader(token),
        payload,
      });
    }

    async function doneNoteWithEverything() {
      const fx = await createBoardFixture(ctx);
      const created = await createNote(fx.boardId, fx.ownerToken, {
        title: 'Template',
        description: 'What needs doing',
        priority: 'HOCH',
        horizon: 'DIESE_WOCHE',
        freeX: 100,
        freeY: 200,
        dueDate: '2026-11-02',
        assigneeId: fx.editorId,
        tags: ['customer'],
        customFields: { Customer: 'Müller GmbH' },
        colour: 'BUTTER',
      });
      const noteId = created.json().id as string;
      for (const text of ['First', 'Second']) {
        await ctx.inject({
          method: 'POST',
          url: `/notes/${noteId}/subtasks`,
          headers: ctx.authHeader(fx.ownerToken),
          payload: { text },
        });
      }
      const [first] = docsWithId(await subtasksCol(ctx.db, noteId).orderBy('sortIndex').get());
      await ctx.inject({
        method: 'PATCH',
        url: `/notes/${noteId}/subtasks/${first!.id}`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { done: true },
      });
      await ctx.inject({
        method: 'POST',
        url: `/notes/${noteId}/complete`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      return { fx, noteId };
    }

    it('copies every field and every subtask with its tick, and the copy starts open', async () => {
      const { fx, noteId } = await doneNoteWithEverything();
      const res = await duplicate(noteId, fx.editToken);
      expect(res.statusCode).toBe(201);
      const copy = res.json();

      expect(copy.id).not.toBe(noteId);
      expect(copy).toMatchObject({
        title: 'Template',
        description: 'What needs doing',
        status: 'OPEN',
        completedAt: null,
        priority: 'HOCH',
        horizon: 'DIESE_WOCHE',
        freeX: 100,
        freeY: 200,
        dueDate: '2026-11-02',
        tags: ['customer'],
        customFields: { Customer: 'Müller GmbH' },
        colour: 'BUTTER',
        subtaskSummary: { total: 2, done: 1 },
      });
      expect(copy.assignee.id).toBe(fx.editorId);
      expect(copy.createdBy.id).toBe(fx.editorId);

      const detail = await ctx.inject({
        method: 'GET',
        url: `/notes/${copy.id}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      const subtasks = detail.json().subtasks as { text: string; done: boolean }[];
      expect(subtasks.map((s) => [s.text, s.done])).toEqual([
        ['First', true],
        ['Second', false],
      ]);
      expect(detail.json().history).toEqual([
        expect.objectContaining({ type: 'CREATED', metadata: { duplicatedFrom: noteId } }),
      ]);

      // The source is left exactly as it was.
      const source = await ctx.inject({
        method: 'GET',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(source.json().status).toBe('DONE');
      expect(source.json().subtasks).toHaveLength(2);
    });

    it('applies the title, description and placement the client sends', async () => {
      const { fx, noteId } = await doneNoteWithEverything();
      const res = await duplicate(noteId, fx.ownerToken, {
        title: 'Not saved yet',
        description: '',
        horizon: 'SPAETER',
        priority: 'NIEDRIG',
        freeX: 300,
        freeY: 400,
      });
      expect(res.json()).toMatchObject({
        title: 'Not saved yet',
        description: '',
        horizon: 'SPAETER',
        priority: 'NIEDRIG',
        freeX: 300,
        freeY: 400,
      });
    });

    it('drops an assignee who has left the board instead of failing', async () => {
      const { fx, noteId } = await doneNoteWithEverything();
      await notesCol(ctx.db).doc(noteId).update({ assigneeId: 'gone-user' });
      const res = await duplicate(noteId, fx.ownerToken);
      expect(res.statusCode).toBe(201);
      expect(res.json().assignee).toBeNull();
    });

    it('403s for a VIEW member and 404s for a non-member', async () => {
      const fx = await createBoardFixture(ctx);
      const noteId = (await createNote(fx.boardId, fx.ownerToken)).json().id as string;
      expect((await duplicate(noteId, fx.viewToken)).statusCode).toBe(403);
      expect((await duplicate(noteId, fx.outsiderToken)).statusCode).toBe(404);
    });
  });
});
