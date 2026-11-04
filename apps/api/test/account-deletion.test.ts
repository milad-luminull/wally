import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { _resetEnvCacheForTests } from '../src/env.js';
import { accountIdentity, eraseAccount } from '../src/lib/account/erase.js';
import type { Auth0UserDeleter } from '../src/lib/auth/management.js';
import { purgeExpired } from '../src/lib/db/purge.js';
import { boardMembers, users } from '../src/lib/postgres/schema/index.js';
import {
  addTestMember,
  buildTestApp,
  createBoardFixture,
  createTestDatabase,
  createTestMembership,
  resetDatabase,
  type TestContext,
} from './helpers.js';

describe('erasing an account', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp();
  });
  afterEach(() => resetDatabase(ctx.db));
  afterAll(async () => {
    await resetDatabase(ctx.db);
    await ctx.app.close();
  });

  const create = async (boardId: string, token: string, title: string) =>
    (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${boardId}/notes`,
        headers: ctx.authHeader(token),
        payload: { title },
      })
    ).json() as { id: string };
  const listNotes = async (boardId: string, token: string) =>
    (
      await ctx.inject({
        method: 'GET',
        url: `/whiteboards/${boardId}/notes`,
        headers: ctx.authHeader(token),
      })
    ).json() as { id: string; title: string; links: string[] }[];

  /** The owner also edits the editor's own board, and writes a note there. */
  async function ownerWritesOnEditorsBoard() {
    const fx = await createBoardFixture(ctx);
    await addTestMember(ctx.db, fx.editorId, fx.ownerId, 'EDIT');
    const mine = await create(fx.editorId, fx.ownerToken, 'Mine');
    const theirs = await create(fx.editorId, fx.editToken, 'Theirs');
    return { fx, mine, theirs };
  }
  const erase = async (userId: string) =>
    eraseAccount(ctx.db, userId, await accountIdentity(ctx.db, userId));

  it('erases the account, its boards for everyone, and its notes on other boards', async () => {
    const { fx } = await ownerWritesOnEditorsBoard();
    await erase(fx.ownerId);

    const board = await ctx.inject({
      method: 'GET',
      url: `/whiteboards/${fx.boardId}`,
      headers: ctx.authHeader(fx.editToken),
    });
    expect(board.statusCode).toBe(404);
    expect((await listNotes(fx.editorId, fx.editToken)).map((n) => n.title)).toEqual(['Theirs']);
    expect(await ctx.db.$count(users, eq(users.id, fx.ownerId))).toBe(0);
  });

  it('drops links to the erased notes from notes that stay', async () => {
    const { fx, mine, theirs } = await ownerWritesOnEditorsBoard();
    const linked = await ctx.inject({
      method: 'PATCH',
      url: `/notes/${theirs.id}`,
      headers: ctx.authHeader(fx.editToken),
      payload: { linkChanges: { add: [mine.id] } },
    });
    expect(linked.json().links).toEqual([mine.id]);

    await erase(fx.ownerId);

    const [kept] = await listNotes(fx.editorId, fx.editToken);
    expect(kept).toMatchObject({ id: theirs.id, links: [] });
  });

  it('leaves a pending invite to the address in place', async () => {
    const fx = await createBoardFixture(ctx);
    await createTestMembership(ctx.db, fx.viewerId, {
      invitedEmail: 'owner@fixture.de',
      role: 'VIEW',
      status: 'PENDING',
    });

    await erase(fx.ownerId);

    const invites = await ctx.db
      .select()
      .from(boardMembers)
      .where(
        and(
          eq(boardMembers.boardId, fx.viewerId),
          eq(boardMembers.invitedEmail, 'owner@fixture.de'),
        ),
      );
    expect(invites).toHaveLength(1);
  });

  it('refuses a new account for a tombstoned identity until it expires', async () => {
    const fx = await createBoardFixture(ctx);
    await erase(fx.ownerId);

    const refused = await ctx.inject({
      method: 'GET',
      url: '/me',
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error).toBe('ACCOUNT_DELETED');
    expect(await ctx.db.$count(users, eq(users.id, fx.ownerId))).toBe(0);

    await purgeExpired(ctx.db, new Date(Date.now() + 2 * 60 * 60 * 1000));

    const recreated = await ctx.inject({
      method: 'GET',
      url: '/me',
      headers: ctx.authHeader(fx.ownerToken),
    });
    expect(recreated.statusCode).toBe(200);
    expect(await ctx.db.$count(users, eq(users.id, fx.ownerId))).toBe(1);
  });
});

describe('DELETE /me', () => {
  const deleted: string[] = [];
  let failAuth0 = false;
  let afterAuth0: (() => void) | undefined;
  const fakeDeleter: Auth0UserDeleter = {
    async deleteUser(subject) {
      if (failAuth0) throw new Error('Auth0 is down');
      deleted.push(subject);
      afterAuth0?.();
    },
  };
  const lines: string[] = [];
  let ctx: TestContext;
  let skipping: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp({ auth0UserDeleter: fakeDeleter, logLines: lines });
    skipping = await buildTestApp({ auth0UserDeleter: null, logLines: lines });
  });
  afterEach(async () => {
    deleted.length = 0;
    lines.length = 0;
    failAuth0 = false;
    afterAuth0 = undefined;
    vi.restoreAllMocks();
    await resetDatabase(ctx.db);
    await resetDatabase(skipping.db);
  });
  afterAll(async () => {
    await ctx.app.close();
    await skipping.app.close();
  });

  const deleteMe = (c: TestContext, token: string) =>
    c.inject({ method: 'DELETE', url: '/me', headers: c.authHeader(token) });
  const getMe = (c: TestContext, token: string) =>
    c.inject({ method: 'GET', url: '/me', headers: c.authHeader(token) });

  it('deletes the Auth0 user, then the account, and answers 204', async () => {
    const fx = await createBoardFixture(ctx);
    const res = await deleteMe(ctx, fx.ownerToken);
    expect(res.statusCode).toBe(204);
    expect(deleted).toEqual(['test|fx-owner']);
    expect((await getMe(ctx, fx.ownerToken)).statusCode).toBe(401);
  });

  it('erases nothing when Auth0 fails', async () => {
    const fx = await createBoardFixture(ctx);
    failAuth0 = true;
    const res = await deleteMe(ctx, fx.ownerToken);
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('ACCOUNT_DELETE_FAILED');
    expect((await getMe(ctx, fx.ownerToken)).statusCode).toBe(200);
  });

  it('skips Auth0 and logs it when no deleter is configured', async () => {
    const fx = await createBoardFixture(skipping);
    const res = await deleteMe(skipping, fx.ownerToken);
    expect(res.statusCode).toBe(204);
    expect(lines.some((line) => line.includes('auth0 step skipped'))).toBe(true);
    expect(await skipping.db.$count(users, eq(users.id, fx.ownerId))).toBe(0);
  });

  it('logs the user id when the database step fails after Auth0', async () => {
    const fx = await createBoardFixture(ctx);
    afterAuth0 = () => {
      vi.spyOn(ctx.db, 'transaction').mockRejectedValue(new Error('database unavailable'));
    };
    const res = await deleteMe(ctx, fx.ownerToken);
    expect(res.statusCode).toBe(500);
    const logged = lines
      .map((line) => JSON.parse(line))
      .find((l) => l.msg === 'account erase failed');
    expect(logged).toMatchObject({ userId: fx.ownerId, auth0Deleted: true });
  });
});

describe('the production API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetEnvCacheForTests();
  });

  it('refuses to start without the Auth0 Management settings', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    _resetEnvCacheForTests();
    const handle = await createTestDatabase();
    try {
      await expect(buildApp({ db: handle.db, logger: false })).rejects.toThrow(
        'AUTH0_MANAGEMENT_CLIENT_ID and AUTH0_MANAGEMENT_CLIENT_SECRET are required in production',
      );
    } finally {
      await handle.drop();
    }
  });
});
