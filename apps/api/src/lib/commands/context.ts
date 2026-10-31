import type { EffectiveRole } from '@wally/shared';
import type { Board, Note } from '../db/types.js';
import type { Database } from '../postgres/client.js';
import type { Transaction } from '../postgres/transaction.js';
import { AppError } from '../errors.js';
import { resolveRole } from '../authorization.js';
import type { Provenance } from '../assistant/provenance.js';

export interface Actor {
  id: string;
  email: string;
  emailVerified: boolean;
}
export interface CommandResult {
  data: unknown;
  revision: number;
  status: number;
  boardId: string;
  cleanupId?: string;
}
export interface CommandContext {
  db: Database;
  tx: Transaction;
  actor: Actor;
  board: Board;
  note: Note | null;
  operationId: string;
  baseUrl: string;
  /** Present when the assistant is the caller; absent for the browser. */
  provenance?: Provenance;
}
export function requireAccess(
  board: Board | null,
  actorId: string,
  allowed: EffectiveRole[],
): EffectiveRole {
  const role = board && resolveRole(board, actorId);
  if (!board || !role) throw new AppError(404, 'NOT_FOUND', 'Not found');
  if (!allowed.includes(role)) throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
  return role;
}
export function notFound(): never {
  throw new AppError(404, 'NOT_FOUND', 'Not found');
}
