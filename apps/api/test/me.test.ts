import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { INITIAL_BOARD_NAME } from '@wally/shared';
import { usersCol, whiteboardsCol } from '../src/lib/db/collections.js';
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

  it('rejects an unauthenticated caller', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/me' });
    expect(response.statusCode).toBe(401);
  });

  it('returns the profile, defaulting a caller with no Accept-Language to German', async () => {
    const token = registerTestUser(ctx, 'me-de', 'max.berger@finlex.de', 'Max Berger');

    const response = await ctx.app.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'me-de',
      email: 'max.berger@finlex.de',
      displayName: 'Max Berger',
      language: 'de',
    });
  });

  it('seeds the language AND the board name from Accept-Language on a first request', async () => {
    const token = registerTestUser(ctx, 'me-en', 'jo.taylor@finlex.de', 'Jo Taylor');

    const response = await ctx.app.inject({
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
    await createTestUser(ctx.db, 'me-legacy', 'legacy@finlex.de', 'Legacy', true, 'absent');
    const token = registerTestUser(ctx, 'me-legacy', 'legacy@finlex.de', 'Legacy');

    const response = await ctx.app.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });

    expect(response.json().language).toBe('de');
    const stored = await usersCol(ctx.db).doc('me-legacy').get();
    expect('language' in (stored.data() ?? {})).toBe(false);
  });

  it('persists a language change', async () => {
    const token = registerTestUser(ctx, 'me-patch', 'patch@finlex.de');

    const response = await ctx.app.inject({
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
    const token = registerTestUser(ctx, 'me-bad', 'bad@finlex.de');
    await ctx.app.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });

    const response = await ctx.app.inject({
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
    const token = registerTestUser(ctx, 'me-empty', 'empty@finlex.de');

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  // The core invariant: Accept-Language seeds a profile, it never steers an existing one.
  it('keeps the stored language when a later request disagrees with it', async () => {
    const token = registerTestUser(ctx, 'me-stored', 'stored@finlex.de');
    await ctx.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: { language: 'en' },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/me',
      headers: { ...ctx.authHeader(token), ...DE_HEADER },
    });

    expect(response.json().language).toBe('en');
  });

  // Regression guard for the sharpest edge in this change: provisionUser's tx.update names a
  // fixed field list, so a Firebase profile change must not take `language` down with it.
  it('preserves the language when the Firebase profile changes', async () => {
    const token = registerTestUser(ctx, 'me-rename', 'rename@finlex.de', 'Original');
    await ctx.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: { language: 'en' },
    });

    // Force the provisioning update branch by changing the name on the token.
    ctx.tokens.set(token, { uid: 'me-rename', email: 'rename@finlex.de', emailVerified: true, name: 'Renamed' });
    const response = await ctx.app.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });

    expect(response.json()).toMatchObject({ displayName: 'Renamed', language: 'en' });
    const stored = await usersCol(ctx.db).doc('me-rename').get();
    expect(stored.data()).toMatchObject({ displayName: 'Renamed', language: 'en' });
  });

  it('leaves the board name alone when the language changes later', async () => {
    const token = registerTestUser(ctx, 'me-board', 'board@finlex.de');
    await ctx.app.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });

    await ctx.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: ctx.authHeader(token),
      payload: { language: 'en' },
    });

    const board = await whiteboardsCol(ctx.db).doc('me-board').get();
    expect(board.data()?.name).toBe(INITIAL_BOARD_NAME.de);
  });

  // A returning user whose board was deleted must be renamed from their PROFILE, not from
  // whatever locale today's browser reports.
  it('recreates a deleted board from the stored language, not the header', async () => {
    const token = registerTestUser(ctx, 'me-rebuild', 'rebuild@finlex.de');
    await ctx.app.inject({ method: 'GET', url: '/me', headers: ctx.authHeader(token) });
    await whiteboardsCol(ctx.db).doc('me-rebuild').delete();

    await ctx.app.inject({
      method: 'GET',
      url: '/me',
      headers: { ...ctx.authHeader(token), ...EN_HEADER },
    });

    const board = await whiteboardsCol(ctx.db).doc('me-rebuild').get();
    expect(board.data()?.name).toBe(INITIAL_BOARD_NAME.de);
  });
});
