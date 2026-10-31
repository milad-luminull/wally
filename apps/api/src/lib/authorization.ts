import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { EffectiveRole } from '@wally/shared';
import type { Board, Note } from './db/types.js';
import { liveBoard, loadNote, type Queryable } from './db/records.js';
import { canSeeNote } from './notes.js';

declare module 'fastify' {
  interface FastifyRequest {
    whiteboardContext?: {
      whiteboardId: string;
      role: EffectiveRole;
      /** The board, already loaded while resolving access. */
      board: Board;
    };
    /**
     * The note a `noteParam` route is about, already loaded while resolving access.
     * Handlers reuse it instead of reading the same row a second time.
     */
    noteContext?: Note;
  }
}

/**
 * The caller's role on an already-loaded board: OWNER if they own it, else the role of
 * their ACTIVE membership, else null.
 *
 * Answered by the loaded board alone, via its `memberRoles` map, which liveBoard reads with
 * the board in the same query.
 */
export function resolveRole(board: Board, userId: string): EffectiveRole | null {
  if (board.ownerId === userId) return 'OWNER';
  return board.memberRoles[userId] ?? null;
}

/**
 * Resolves the caller's effective role on a whiteboard, or null for no access at all —
 * including "whiteboard doesn't exist", which the caller must not be able to distinguish
 * from "exists but I'm not a member".
 */
export async function getEffectiveRole(
  q: Queryable,
  userId: string,
  whiteboardId: string,
): Promise<EffectiveRole | null> {
  const board = await liveBoard(q, whiteboardId);
  return board ? resolveRole(board, userId) : null;
}

type WhiteboardSource =
  { kind: 'whiteboardParam'; paramName?: string } | { kind: 'noteParam'; paramName?: string };

/**
 * Composable preHandler #1: resolves which whiteboard the request is about (directly
 * from a `:id` whiteboard param, or by loading a `:id` note and using its
 * whiteboardId), resolves the caller's effective role on it, and 404s if they have no
 * role at all. On success it stashes `{ whiteboardId, role }` on the request for
 * `requireRole` (and route handlers) to use — this is what lets "note doesn't exist",
 * "note exists but you're not a member" and "note is someone else's private note" all
 * come back as the same plain 404.
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
      const loaded = await loadNote(db, paramValue);
      // Someone else's private note is answered exactly like a note that does not exist.
      const note = loaded && canSeeNote(loaded, request.user.id) ? loaded : null;
      if (note) request.noteContext = note;
      whiteboardId = note?.boardId;
    }

    if (!whiteboardId) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Not found' });
    }

    const board = await liveBoard(db, whiteboardId);
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
