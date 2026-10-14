import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_OWN_BOARDS } from '@wally/shared';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

/** RFC BOARD_HOME §8–§10, §12: creating, deleting and leaving boards. */
const projectId = 'wally-boards-lifecycle';
let ctx: TestContext;
let fx: Awaited<ReturnType<typeof createBoardFixture>>;

beforeAll(async () => {
  ctx = await buildTestApp(projectId);
});
beforeEach(async () => {
  await resetDatabase(projectId);
  fx = await createBoardFixture(ctx);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await ctx.app.close();
});

const create = (token: string, name = 'Projekt Nord', key = randomUUID()) =>
  ctx.app.inject({
    method: 'POST',
    url: '/whiteboards',
    headers: { ...ctx.authHeader(token), 'idempotency-key': key },
    payload: { name },
  });

const listIds = async (token: string) =>
  (
    await ctx.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) })
  ).json() as { id: string; name: string; currentUserRole: string }[];

describe('board.create', () => {
  it('creates a second own board with a generated id and lists it as OWNER', async () => {
    const res = await create(fx.ownerToken);
    expect(res.statusCode).toBe(201);
    const dto = res.json();
    expect(dto).toMatchObject({
      name: 'Projekt Nord',
      ownerId: fx.ownerId,
      currentUserRole: 'OWNER',
      revision: 1,
    });
    expect(dto.id).not.toBe(fx.ownerId);
    expect(res.headers['x-resource-revision']).toBe('1');
    expect(await listIds(fx.ownerToken)).toEqual(
      expect.arrayContaining([{ id: dto.id, name: 'Projekt Nord', currentUserRole: 'OWNER' }]),
    );
  });

  it('replays the same operation id instead of creating twice', async () => {
    const key = randomUUID();
    const first = await create(fx.ownerToken, 'Einmal', key);
    const second = await create(fx.ownerToken, 'Einmal', key);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect((await create(fx.ownerToken, 'Anders', key)).statusCode).toBe(409);
    expect((await listIds(fx.ownerToken)).filter((b) => b.name === 'Einmal')).toHaveLength(1);
  });

  it('refuses a blank name and a missing operation id', async () => {
    expect((await create(fx.ownerToken, '   ')).statusCode).toBe(400);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/whiteboards',
      headers: ctx.authHeader(fx.ownerToken),
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(428);
  });

  it('stops at MAX_OWN_BOARDS live boards', async () => {
    // The fixture owner already owns their provisioned board.
    for (let i = 1; i < MAX_OWN_BOARDS; i++)
      expect((await create(fx.ownerToken, `Wand ${i}`)).statusCode).toBe(201);
    const over = await create(fx.ownerToken, 'Eine zu viel');
    expect(over.statusCode).toBe(422);
    expect(over.json().error).toBe('BOARD_LIMIT_REACHED');
  });
});
