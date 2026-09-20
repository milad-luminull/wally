import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { historyCol, notesCol, subtasksCol, withId } from '../src/lib/db/collections.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

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

  async function createNote(boardId: string, token: string, overrides: Record<string, unknown> = {}) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/notes`,
      headers: ctx.authHeader(token),
      payload: { title: 'Testnotiz', ...overrides },
    });
    return res;
  }

  describe('GET /whiteboards/:id/notes', () => {
    it('200s for owner/EDIT/VIEW, 404s for a non-member', async () => {
      const fx = await createBoardFixture(ctx);
      await createNote(fx.boardId, fx.ownerToken);

      for (const token of [fx.ownerToken, fx.editToken, fx.viewToken]) {
        const res = await ctx.app.inject({
          method: 'GET',
          url: `/whiteboards/${fx.boardId}/notes`,
          headers: ctx.authHeader(token),
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toHaveLength(1);
      }

      const forbidden = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(forbidden.statusCode).toBe(404);
    });

    it('q filter matches title, custom fields, and tags, case-insensitively', async () => {
      const fx = await createBoardFixture(ctx);
      await createNote(fx.boardId, fx.ownerToken, { title: 'Cyber-Police prüfen' });
      await createNote(fx.boardId, fx.ownerToken, {
        title: 'Irrelevant',
        customFields: { Vertrag: 'Cyber-Paket Plus' },
      });
      await createNote(fx.boardId, fx.ownerToken, { title: 'Irrelevant', tags: ['cyber'] });
      await createNote(fx.boardId, fx.ownerToken, { title: 'Ganz anderes Thema' });

      const res = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes?q=CYBER`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(3);
    });

    it('field filter matches by key alone and by key:value, case-insensitively', async () => {
      const fx = await createBoardFixture(ctx);
      await createNote(fx.boardId, fx.ownerToken, {
        title: 'A',
        customFields: { Kunde: 'Müller GmbH' },
      });
      await createNote(fx.boardId, fx.ownerToken, {
        title: 'B',
        customFields: { Kunde: 'Steiner AG' },
      });
      await createNote(fx.boardId, fx.ownerToken, {
        title: 'C',
        customFields: { Vertragsnr: '4711' },
      });
      await createNote(fx.boardId, fx.ownerToken, { title: 'D' });

      const byKey = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes?field=${encodeURIComponent('kunde')}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(byKey.json()).toHaveLength(2);

      const byPair = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes?field=${encodeURIComponent('Kunde:müller gmbh')}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(byPair.json()).toHaveLength(1);
      expect(byPair.json()[0].title).toBe('A');
    });

    it('orders by due date, with undated notes last and none dropped', async () => {
      // Firestore sorts null first and omits documents missing the ordered field
      // entirely, so this ordering is done in memory. Both halves matter: an undated note
      // must come last AND must still be in the list at all.
      const fx = await createBoardFixture(ctx);
      await createNote(fx.boardId, fx.ownerToken, { title: 'Ohne Datum' });
      await createNote(fx.boardId, fx.ownerToken, { title: 'Spät', dueDate: '2027-01-31' });
      await createNote(fx.boardId, fx.ownerToken, { title: 'Früh', dueDate: '2026-01-31' });

      const res = await ctx.app.inject({
        method: 'GET',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((n: { title: string }) => n.title)).toEqual([
        'Früh',
        'Spät',
        'Ohne Datum',
      ]);
    });
  });

  describe('POST /whiteboards/:id/notes (create)', () => {
    it('201s for owner and EDIT, and writes a CREATED history event', async () => {
      const fx = await createBoardFixture(ctx);
      const res = await createNote(fx.boardId, fx.editToken, { title: 'Neue Notiz' });
      expect(res.statusCode).toBe(201);
      const note = res.json();

      const detail = await ctx.app.inject({
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

    it('persists custom fields, and defaults them to {} when omitted', async () => {
      const fx = await createBoardFixture(ctx);

      const withFields = await createNote(fx.boardId, fx.ownerToken, {
        customFields: { Kunde: 'Müller GmbH', Vertragsnr: '4711' },
      });
      expect(withFields.statusCode).toBe(201);
      expect(withFields.json().customFields).toEqual({ Kunde: 'Müller GmbH', Vertragsnr: '4711' });

      const without = await createNote(fx.boardId, fx.ownerToken);
      expect(without.json().customFields).toEqual({});
    });

    it('400s on custom fields that break the key rules or the per-note cap', async () => {
      const fx = await createBoardFixture(ctx);
      const tooMany = Object.fromEntries(
        Array.from({ length: 21 }, (_, i) => [`Feld${i}`, 'x']),
      );

      for (const customFields of [
        tooMany,
        { Kunde: 'A', kunde: 'B' }, // same property in two casings
        { 'Kunde.Name': 'A' }, // Firestore field-path metacharacter
        { [`${'k'.repeat(41)}`]: 'A' }, // key over FIELD_KEY_MAX_LENGTH
        { Kunde: 'v'.repeat(201) }, // value over FIELD_VALUE_MAX_LENGTH
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
      const ok = await ctx.app.inject({
        method: 'PATCH',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.editToken),
        payload: { title: 'Geändert' },
      });
      expect(ok.statusCode).toBe(200);

      const forbidden = await ctx.app.inject({
        method: 'PATCH',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.viewToken),
        payload: { title: 'Nope' },
      });
      expect(forbidden.statusCode).toBe(403);

      const notFound = await ctx.app.inject({
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
        ctx.app.inject({
          method: 'PATCH',
          url: `/notes/${noteId}`,
          headers: ctx.authHeader(fx.ownerToken),
          payload,
        });

      const set = await patch({ customFields: { Kunde: 'Müller GmbH' } });
      expect(set.json().customFields).toEqual({ Kunde: 'Müller GmbH' });

      // Touching an unrelated field must not disturb them.
      const untouched = await patch({ title: 'Anderer Titel' });
      expect(untouched.json().customFields).toEqual({ Kunde: 'Müller GmbH' });

      const cleared = await patch({ customFields: {} });
      expect(cleared.json().customFields).toEqual({});
    });

    it('POST /notes/:id/move — HORIZON mode leaves priority/freeX/freeY untouched', async () => {
      const { fx, noteId } = await setup();
      const before = await ctx.app.inject({
        method: 'GET',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      const beforeNote = before.json();

      const res = await ctx.app.inject({
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

      const detail = await ctx.app.inject({
        method: 'GET',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      const moved = detail.json().history.find((h: { type: string }) => h.type === 'MOVED');
      expect(moved.metadata).toEqual({ mode: 'HORIZON', from: 'HEUTE', to: 'SPAETER' });
    });

    it('POST /notes/:id/move — 403 for VIEW, 404 for non-member', async () => {
      const { fx, noteId } = await setup();
      const forbidden = await ctx.app.inject({
        method: 'POST',
        url: `/notes/${noteId}/move`,
        headers: ctx.authHeader(fx.viewToken),
        payload: { mode: 'PRIORITY', priority: 'HOCH' },
      });
      expect(forbidden.statusCode).toBe(403);

      const notFound = await ctx.app.inject({
        method: 'POST',
        url: `/notes/${noteId}/move`,
        headers: ctx.authHeader(fx.outsiderToken),
        payload: { mode: 'PRIORITY', priority: 'HOCH' },
      });
      expect(notFound.statusCode).toBe(404);
    });

    it('POST /notes/:id/assign — 200 for a valid active member, 422 for a non-member', async () => {
      const { fx, noteId } = await setup();
      const ok = await ctx.app.inject({
        method: 'POST',
        url: `/notes/${noteId}/assign`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { assigneeId: fx.editorId },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().assignee.id).toBe(fx.editorId);

      const invalid = await ctx.app.inject({
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
      const completed = await ctx.app.inject({
        method: 'POST',
        url: `/notes/${noteId}/complete`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(completed.statusCode).toBe(200);
      expect(completed.json().status).toBe('DONE');
      expect(completed.json().completedAt).not.toBeNull();

      const reopened = await ctx.app.inject({
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

      const forbidden = await ctx.app.inject({
        method: 'DELETE',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.viewToken),
      });
      expect(forbidden.statusCode).toBe(403);

      const notFound = await ctx.app.inject({
        method: 'DELETE',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.outsiderToken),
      });
      expect(notFound.statusCode).toBe(404);

      const ok = await ctx.app.inject({
        method: 'DELETE',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.editToken),
      });
      expect(ok.statusCode).toBe(204);

      const gone = withId(await notesCol(ctx.db).doc(noteId).get());
      expect(gone).toBeNull();
    });

    it('DELETE /notes/:id takes the note\'s subtasks and history with it', async () => {
      // Firestore does not delete subcollections when their parent document goes, and
      // there are no foreign keys left to cascade — the route has to do this by hand.
      const { fx, noteId } = await setup();
      await ctx.app.inject({
        method: 'POST',
        url: `/notes/${noteId}/subtasks`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { text: 'Hängt am Note' },
      });
      expect((await subtasksCol(ctx.db, noteId).get()).size).toBe(1);
      expect((await historyCol(ctx.db, noteId).get()).size).toBe(1); // the CREATED event

      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/notes/${noteId}`,
        headers: ctx.authHeader(fx.ownerToken),
      });
      expect(deleted.statusCode).toBe(204);

      expect((await subtasksCol(ctx.db, noteId).get()).size).toBe(0);
      expect((await historyCol(ctx.db, noteId).get()).size).toBe(0);
    });
  });
});
