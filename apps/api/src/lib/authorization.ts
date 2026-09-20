import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Firestore } from 'firebase-admin/firestore';
import type { EffectiveRole } from '@wally/shared';
import type { NoteDoc, WhiteboardDoc, WithId } from './db/types.js';
import { notesCol, whiteboardsCol, withId } from './db/collections.js';

declare module 'fastify' {
  interface FastifyRequest {
    whiteboardContext?: {
      whiteboardId: string;
      role: EffectiveRole;
      /** The board document, already loaded while resolving access. */
      board: WithId<WhiteboardDoc>;
    };
    /**
     * The note a `noteParam` route is about, already loaded while resolving access.
     * Handlers reuse it instead of reading the same document a second time.
     */
    noteContext?: WithId<NoteDoc>;
  }
}

/**
 * The caller's role on an already-loaded board: OWNER if they own it, else the role of
 * their ACTIVE membership, else null.
 *
 * Answered by the board document alone, via its `memberRoles` map. This runs on nearly
 * every request, which is why active memberships are mirrored onto the board rather than
 * costing a second query here.
 */
export function resolveRole(
  board: WithId<WhiteboardDoc>,
  userId: string,
): EffectiveRole | null {
  if (board.ownerId === userId) return 'OWNER';
  return board.memberRoles[userId] ?? null;
}

/**
 * Resolves the caller's effective role on a whiteboard, or null for no access at all —
 * including "whiteboard doesn't exist", which the caller must not be able to distinguish
 * from "exists but I'm not a member".
 */
export async function getEffectiveRole(
  db: Firestore,
  userId: string,
  whiteboardId: string,
): Promise<EffectiveRole | null> {
  const board = withId(await whiteboardsCol(db).doc(whiteboardId).get());
  return board ? resolveRole(board, userId) : null;
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
    const db = request.server.db;

    if (!paramValue) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found' });
    }

    let whiteboardId: string | undefined;
    if (source.kind === 'whiteboardParam') {
      whiteboardId = paramValue;
    } else {
      const note = withId(await notesCol(db).doc(paramValue).get());
      if (note) request.noteContext = note;
      whiteboardId = note?.whiteboardId;
    }

    if (!whiteboardId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found' });
    }

    const board = withId(await whiteboardsCol(db).doc(whiteboardId).get());
    const role = board ? resolveRole(board, request.user.id) : null;
    if (!board || !role) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found' });
    }

    request.whiteboardContext = { whiteboardId, role, board };
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
