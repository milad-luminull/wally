import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, registerTestUser, resetDatabase, type TestContext } from './helpers.js';

describe('auth preHandler', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  it('401s on a protected route with no Authorization header', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/whiteboards' });
    expect(res.statusCode).toBe(401);
  });

  it('401s on a protected route with an invalid token', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('upserts the User row and lazily provisions their whiteboard on first request', async () => {
    const token = registerTestUser(ctx, 'auth-new-user', 'brand-new@finlex.de', 'Brand New');

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/whiteboards',
      headers: ctx.authHeader(token),
    });
    expect(res.statusCode).toBe(200);

    const user = await ctx.prisma.user.findUnique({ where: { id: 'auth-new-user' } });
    expect(user?.email).toBe('brand-new@finlex.de');

    const board = await ctx.prisma.whiteboard.findUnique({ where: { ownerId: 'auth-new-user' } });
    expect(board?.name).toBe('Meine Wand');
  });

  it('auto-activates a pending invite matching the caller email, case-insensitively', async () => {
    const ownerToken = registerTestUser(ctx, 'auth-owner', 'auth-owner@finlex.de');
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(ownerToken) });
    const board = await ctx.prisma.whiteboard.findUniqueOrThrow({ where: { ownerId: 'auth-owner' } });

    await ctx.prisma.whiteboardMember.create({
      data: {
        whiteboardId: board.id,
        invitedEmail: 'invitee@finlex.de',
        role: 'EDIT',
        status: 'PENDING',
      },
    });

    // The invited person authenticates with an email that differs only in case.
    const inviteeToken = registerTestUser(ctx, 'auth-invitee', 'INVITEE@FINLEX.DE');
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(inviteeToken) });

    const member = await ctx.prisma.whiteboardMember.findFirst({ where: { whiteboardId: board.id } });
    expect(member?.status).toBe('ACTIVE');
    expect(member?.userId).toBe('auth-invitee');
  });
});
