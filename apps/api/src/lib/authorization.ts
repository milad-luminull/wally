import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { PrismaClient } from './prisma-client.js';
import type { EffectiveRole } from '@wally/shared';

declare module 'fastify' {
  interface FastifyRequest {
    whiteboardContext?: {
      whiteboardId: string;
      role: EffectiveRole;
    };
  }
}

/**
 * Resolves the caller's effective role on a whiteboard: OWNER if they own it, else the
 * role of their ACTIVE WhiteboardMember row, else null (no access at all — including
 * "whiteboard doesn't exist", which the caller must not be able to distinguish from
 * "exists but I'm not a member").
 */
export async function getEffectiveRole(
  prisma: PrismaClient,
  userId: string,
  whiteboardId: string,
): Promise<EffectiveRole | null> {
  const whiteboard = await prisma.whiteboard.findUnique({
    where: { id: whiteboardId },
    select: { ownerId: true },
  });
  if (!whiteboard) return null;
  if (whiteboard.ownerId === userId) return 'OWNER';

  const member = await prisma.whiteboardMember.findFirst({
    where: { whiteboardId, userId, status: 'ACTIVE' },
    select: { role: true },
  });
  return member ? member.role : null;
}

type WhiteboardSource =
  | { kind: 'whiteboardParam'; paramName?: string }
  | { kind: 'noteParam'; paramName?: string };

/**
 * Composable preHandler #1: resolves which whiteboard the request is about (directly
 * from a `:id` whiteboard param, or by loading a `:id` note and using its
 * whiteboardId), resolves the caller's effective role on it, and 404s if they have no
 * role at all. On success it stashes `{ whiteboardId, role }` on the request for
 * `requireRole` (and route handlers) to use — this is what lets "note doesn't exist"
 * and "note exists but you're not a member" both come back as a plain 404.
 */
export function requireWhiteboardAccess(source: WhiteboardSource): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const paramName = source.paramName ?? 'id';
    const params = request.params as Record<string, string>;
    const paramValue = params[paramName];
    const prisma = request.server.prisma;

    let whiteboardId: string | undefined;
    if (source.kind === 'whiteboardParam') {
      whiteboardId = paramValue;
    } else {
      const note = await prisma.note.findUnique({
        where: { id: paramValue },
        select: { whiteboardId: true },
      });
      whiteboardId = note?.whiteboardId;
    }

    if (!whiteboardId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found' });
    }

    const role = await getEffectiveRole(prisma, request.user.id, whiteboardId);
    if (!role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found' });
    }

    request.whiteboardContext = { whiteboardId, role };
  };
}

/**
 * Composable preHandler #2: 403s unless the role resolved by `requireWhiteboardAccess`
 * is in the allowed set. Must run after `requireWhiteboardAccess` in the preHandler chain.
 */
export function requireRole(allowed: EffectiveRole[]): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = request.whiteboardContext;
    if (!ctx || !allowed.includes(ctx.role)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Insufficient role' });
    }
  };
}
