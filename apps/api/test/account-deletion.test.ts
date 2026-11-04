import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { accountIdentity, eraseAccount } from '../src/lib/account/erase.js';
import { purgeExpired } from '../src/lib/db/purge.js';
import { boardMembers, users } from '../src/lib/postgres/schema/index.js';
import {
  addTestMember,
  buildTestApp,
  createBoardFixture,
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
