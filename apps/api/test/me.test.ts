import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { INITIAL_BOARD_NAME, MAX_REMEMBERED_BOARDS } from '@wally/shared';
import { notesCol, usersCol, whiteboardsCol } from '../src/lib/db/collections.js';
import {
  buildTestApp,
  createTestUser,
  registerTestUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

const PROJECT_ID = 'wally-test-me';

/** Chrome's real header, and its German counterpart. */
const EN_HEADER = { 'accept-language': 'en-US,en;q=0.9,de;q=0.8' };
const DE_HEADER = { 'accept-language': 'de-DE,de;q=0.9' };

describe('/me', () => {
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

  it('saves a palette independently, defaults older profiles and rejects unknown names', async () => {
    const token = registerTestUser(ctx, 'palette-user', 'palette@example.com');
    const before = await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });
    expect(before.json().preferences.palette).toBe('paper');
    const saved = await ctx.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: {
        language: 'en',
        preferences: { palette: 'minimal', theme: 'dark', canvas: 'grid' },
      },
    });
    expect(saved.statusCode).toBe(200);
    const after = await ctx.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: { preferences: { theme: 'light' } },
    });
    expect(after.json()).toMatchObject({
      language: 'en',
      preferences: { palette: 'minimal', theme: 'light', canvas: 'grid' },
    });
    const bad = await ctx.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: { preferences: { palette: 'made-up' } },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('rejects an unauthenticated caller', async () => {
    const response = await ctx.inject({ method: 'GET', url: '/me' });
    expect(response.statusCode).toBe(401);
  });

  it('returns the profile, defaulting a caller with no Accept-Language to German', async () => {
    const token = registerTestUser(ctx, 'me-de', 'mika.brandt@example.com', 'Mika Brandt');

    const response = await ctx.inject({
      method: 'GET',
      url: '/me',
      headers: ctx.authHeader(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'me-de',
      email: 'mika.brandt@example.com',
      displayName: 'Mika Brandt',
      language: 'de',
      preferences: {
        theme: 'system',
        palette: 'paper',
        canvas: 'dots',
        lastBoardId: null,
        boards: {},
        wallybot: { autoApply: true },
      },
    });
  });

  it('seeds the language AND the board name from Accept-Language on a first request', async () => {
    const token = registerTestUser(ctx, 'me-en', 'jo.taylor@example.com', 'Jo Taylor');

    const response = await ctx.inject({
      method: 'GET',
      url: '/me',
      headers: { ...ctx.authHeader(token), ...EN_HEADER },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().language).toBe('en');
    const board = await whiteboardsCol(ctx.db).doc('me-en').get();
    expect(board.data()?.name).toBe(INITIAL_BOARD_NAME.en);
  });

  it('reads a profile written before the field existed as German, without writing to it', async () => {
    // 'absent' writes no field at all, which is exactly the shape of a record created before
    // `language` was introduced.
    await createTestUser(ctx.db, 'me-legacy', 'legacy@example.com', 'Legacy', true, 'absent');
    const token = registerTestUser(ctx, 'me-legacy', 'legacy@example.com', 'Legacy');

    const response = await ctx.inject({
      method: 'GET',
      url: '/me',
      headers: ctx.authHeader(token),
    });

    expect(response.json().language).toBe('de');
    const stored = await usersCol(ctx.db).doc('me-legacy').get();
    expect('language' in (stored.data() ?? {})).toBe(false);
  });

  it('persists a language change', async () => {
    const token = registerTestUser(ctx, 'me-patch', 'patch@example.com');

    const response = await ctx.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: { language: 'en' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().language).toBe('en');
    const stored = await usersCol(ctx.db).doc('me-patch').get();
    expect(stored.data()?.language).toBe('en');
  });

  it('rejects a language outside the enum, leaving the stored value alone', async () => {
    const token = registerTestUser(ctx, 'me-bad', 'bad@example.com');
    await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });

    const response = await ctx.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: { language: 'fr' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('BAD_REQUEST');
    const stored = await usersCol(ctx.db).doc('me-bad').get();
    expect(stored.data()?.language).toBe('de');
  });

  it('rejects an empty body', async () => {
    const token = registerTestUser(ctx, 'me-empty', 'empty@example.com');

    const response = await ctx.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  // The core invariant: Accept-Language seeds a profile, it never steers an existing one.
  it('keeps the stored language when a later request disagrees with it', async () => {
    const token = registerTestUser(ctx, 'me-stored', 'stored@example.com');
    await ctx.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: { language: 'en' },
    });

    const response = await ctx.inject({
      method: 'GET',
      url: '/me',
      headers: { ...ctx.authHeader(token), ...DE_HEADER },
    });

    expect(response.json().language).toBe('en');
  });

  // Regression guard for the sharpest edge in this change: provisionUser's tx.update names a
  // fixed field list, so a Firebase profile change must not take `language` down with it.
  it('preserves the language when the Firebase profile changes', async () => {
    const token = registerTestUser(ctx, 'me-rename', 'rename@example.com', 'Original');
    await ctx.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: { language: 'en' },
    });

    // Force the provisioning update branch by changing the name on the token.
    ctx.tokens.set(token, {
      uid: 'me-rename',
      email: 'rename@example.com',
      emailVerified: true,
      name: 'Renamed',
    });
    const response = await ctx.inject({
      method: 'GET',
      url: '/me',
      headers: ctx.authHeader(token),
    });

    expect(response.json()).toMatchObject({ displayName: 'Renamed', language: 'en' });
    const stored = await usersCol(ctx.db).doc('me-rename').get();
    expect(stored.data()).toMatchObject({ displayName: 'Renamed', language: 'en' });
  });

  it('leaves the board name alone when the language changes later', async () => {
    const token = registerTestUser(ctx, 'me-board', 'board@example.com');
    await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });

    await ctx.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: { language: 'en' },
    });

    const board = await whiteboardsCol(ctx.db).doc('me-board').get();
    expect(board.data()?.name).toBe(INITIAL_BOARD_NAME.de);
  });

  // Deleting your last board is allowed (RFC 0002 §3); the next request must not quietly
  // hand you a fresh "Meine Wand".
  it('does not recreate a board that was deleted', async () => {
    const token = registerTestUser(ctx, 'me-rebuild', 'rebuild@example.com');
    await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });
    await whiteboardsCol(ctx.db).doc('me-rebuild').delete();

    await ctx.inject({
      method: 'GET',
      url: '/me',
      headers: { ...ctx.authHeader(token), ...EN_HEADER },
    });

    expect((await whiteboardsCol(ctx.db).doc('me-rebuild').get()).exists).toBe(false);
    const list = await ctx.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: ctx.authHeader(token),
    });
    expect(list.json()).toEqual([]);
  });

  // A brand-new identity whose uid still names a board awaiting cleanup (its user record removed
  // by hand) must not get a fresh board under that id: the deleted board's notes still point at
  // it, and would reappear on the new one before cleanup reached them.
  it('does not provision over a deleted board that is still being cleaned up', async () => {
    const deletedAt = Timestamp.now();
    await whiteboardsCol(ctx.db).doc('me-ghost').set({
      name: 'Old',
      ownerId: 'me-ghost',
      revision: 2,
      memberRoles: {},
      shareLinkToken: null,
      createdAt: deletedAt,
      updatedAt: deletedAt,
      deletedAt,
    });
    await notesCol(ctx.db)
      .doc('ghost-note')
      .set({ whiteboardId: 'me-ghost', title: 'Old' } as never);
    const token = registerTestUser(ctx, 'me-ghost', 'ghost@example.com');

    await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });

    expect((await whiteboardsCol(ctx.db).doc('me-ghost').get()).data()?.deletedAt).toBeTruthy();
    const list = await ctx.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: ctx.authHeader(token),
    });
    expect(list.json()).toEqual([]);
  });

  describe('preferences', () => {
    const LIST_BY_PRIORITY = {
      view: 'list',
      axis: 'priority',
      done: false,
      mine: true,
      priority: ['HOCH'],
      visibility: 'all',
    } as const;
    const WALL_FREE = {
      view: 'wand',
      axis: 'free',
      done: true,
      mine: false,
      priority: [],
      visibility: 'all',
    };

    function patch(token: string, payload: unknown) {
      return ctx.inject({
        method: 'PATCH',
        url: '/me',
        headers: ctx.authHeader(token),
        payload: payload as Record<string, unknown>,
      });
    }

    it('remembers a board view and returns it on the next GET', async () => {
      const token = registerTestUser(ctx, 'pref-save', 'pref-save@example.com');

      const response = await patch(token, { preferences: { boards: { b1: LIST_BY_PRIORITY } } });
      expect(response.statusCode).toBe(200);
      expect(response.json().preferences.boards).toEqual({ b1: LIST_BY_PRIORITY });

      const again = await ctx.inject({
        method: 'GET',
        url: '/me',
        headers: ctx.authHeader(token),
      });
      expect(again.json().preferences.boards).toEqual({ b1: LIST_BY_PRIORITY });
    });

    it('saving one board leaves the other boards, the theme and the language alone', async () => {
      const token = registerTestUser(ctx, 'pref-merge', 'pref-merge@example.com');
      await patch(token, { language: 'en', preferences: { theme: 'dark' } });
      await patch(token, { preferences: { boards: { b1: LIST_BY_PRIORITY } } });

      const response = await patch(token, { preferences: { boards: { b2: WALL_FREE } } });

      expect(response.json()).toMatchObject({
        language: 'en',
        preferences: { theme: 'dark', boards: { b1: LIST_BY_PRIORITY, b2: WALL_FREE } },
      });
      const stored = await usersCol(ctx.db).doc('pref-merge').get();
      expect(Object.keys(stored.data()?.preferences?.boards ?? {}).sort()).toEqual(['b1', 'b2']);
    });

    it('forgets a board when it is sent as null', async () => {
      const token = registerTestUser(ctx, 'pref-reset', 'pref-reset@example.com');
      await patch(token, { preferences: { boards: { b1: LIST_BY_PRIORITY, b2: WALL_FREE } } });

      const response = await patch(token, { preferences: { boards: { b1: null } } });

      expect(response.json().preferences.boards).toEqual({ b2: WALL_FREE });
    });

    it('saves the free-canvas pattern without touching the theme', async () => {
      const token = registerTestUser(ctx, 'pref-canvas', 'pref-canvas@example.com');
      await patch(token, { preferences: { theme: 'dark' } });

      const response = await patch(token, { preferences: { canvas: 'grid' } });

      expect(response.json().preferences).toMatchObject({ theme: 'dark', canvas: 'grid' });
      expect((await patch(token, { preferences: { canvas: 'lines' } })).statusCode).toBe(400);
    });

    it('round-trips the last opened board', async () => {
      const token = registerTestUser(ctx, 'pref-last', 'pref-last@example.com');

      const response = await patch(token, { preferences: { lastBoardId: 'board_42' } });

      expect(response.json().preferences.lastBoardId).toBe('board_42');
    });

    it('saves the Wallybot preference by its own path and defaults it when absent', async () => {
      const token = registerTestUser(ctx, 'u-wb', 'wb@example.com', 'WB');
      const before = await ctx.inject({
        method: 'GET',
        url: '/me',
        headers: ctx.authHeader(token),
      });
      expect(before.json().preferences.wallybot).toEqual({ autoApply: true });
      const res = await ctx.inject({
        method: 'PATCH',
        url: '/me',
        headers: ctx.authHeader(token),
        payload: { preferences: { wallybot: { autoApply: false } } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().preferences.wallybot).toEqual({ autoApply: false });
      const theme = await ctx.inject({
        method: 'PATCH',
        url: '/me',
        headers: ctx.authHeader(token),
        payload: { preferences: { theme: 'dark' } },
      });
      expect(theme.json().preferences).toMatchObject({
        theme: 'dark',
        wallybot: { autoApply: false },
      });
    });

    it('reads a stored profile saved before Wallybot existed as autoApply on, and keeps it', async () => {
      const token = registerTestUser(ctx, 'pref-old', 'pref-old@example.com');
      await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });
      // Preferences as an older client saved them: real values, no `wallybot` key at all.
      await usersCol(ctx.db)
        .doc('pref-old')
        .update({
          preferences: { theme: 'dark', canvas: 'grid', lastBoardId: null, boards: {} },
        } as never);
      const stored = (await usersCol(ctx.db).doc('pref-old').get()).data()?.preferences;
      expect(stored).not.toHaveProperty('wallybot');

      const response = await ctx.inject({
        method: 'GET',
        url: '/me',
        headers: ctx.authHeader(token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().preferences).toEqual({
        theme: 'dark',
        palette: 'paper',
        canvas: 'grid',
        lastBoardId: null,
        boards: {},
        wallybot: { autoApply: true },
      });

      // Saving something else neither writes the default into the profile nor loses it.
      const canvas = await patch(token, { preferences: { canvas: 'none' } });
      expect(canvas.statusCode).toBe(200);
      expect(canvas.json().preferences).toMatchObject({
        theme: 'dark',
        canvas: 'none',
        wallybot: { autoApply: true },
      });
      const after = (await usersCol(ctx.db).doc('pref-old').get()).data()?.preferences;
      expect(after).not.toHaveProperty('wallybot');
    });

    it('rejects unknown keys and board ids that could escape a field path', async () => {
      const token = registerTestUser(ctx, 'pref-bad', 'pref-bad@example.com');

      for (const payload of [
        { preferences: { sortBy: 'name' } },
        { preferences: { boards: { 'a.b': LIST_BY_PRIORITY } } },
        { preferences: { boards: { b1: { ...LIST_BY_PRIORITY, view: 'kanban' } } } },
        { preferences: { theme: 'sepia' } },
      ]) {
        const response = await patch(token, payload);
        expect(response.statusCode).toBe(400);
      }
    });

    it('prunes the least recently saved boards past the cap', async () => {
      const token = registerTestUser(ctx, 'pref-prune', 'pref-prune@example.com');
      await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });
      const boards = Object.fromEntries(
        Array.from({ length: MAX_REMEMBERED_BOARDS }, (_, i) => [
          `old${i}`,
          { ...WALL_FREE, touchedAt: i },
        ]),
      );
      await usersCol(ctx.db).doc('pref-prune').update({ preferences: { boards } });

      const response = await patch(token, { preferences: { boards: { fresh: WALL_FREE } } });

      const kept = Object.keys(response.json().preferences.boards);
      expect(kept).toHaveLength(MAX_REMEMBERED_BOARDS);
      expect(kept).toContain('fresh');
      expect(kept).not.toContain('old0');
    });

    it('survives a Firebase profile change', async () => {
      const token = registerTestUser(ctx, 'pref-keep', 'pref-keep@example.com', 'Before');
      await patch(token, { preferences: { theme: 'light', boards: { b1: WALL_FREE } } });

      ctx.tokens.set(token, {
        uid: 'pref-keep',
        email: 'pref-keep@example.com',
        emailVerified: true,
        name: 'After',
      });
      const response = await ctx.inject({
        method: 'GET',
        url: '/me',
        headers: ctx.authHeader(token),
      });

      expect(response.json()).toMatchObject({
        displayName: 'After',
        preferences: { theme: 'light', boards: { b1: WALL_FREE } },
      });
    });

    it('reads a malformed stored value as the default instead of failing', async () => {
      const token = registerTestUser(ctx, 'pref-junk', 'pref-junk@example.com');
      await ctx.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });
      await usersCol(ctx.db)
        .doc('pref-junk')
        .update({
          preferences: {
            theme: 'sepia',
            canvas: 'lines',
            boards: { b1: { view: 'kanban' } },
            wallybot: { autoApply: 'yes' },
          },
        } as never);

      const response = await ctx.inject({
        method: 'GET',
        url: '/me',
        headers: ctx.authHeader(token),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().preferences).toEqual({
        theme: 'system',
        palette: 'paper',
        canvas: 'dots',
        lastBoardId: null,
        boards: {},
        wallybot: { autoApply: true },
      });
    });
  });
});
