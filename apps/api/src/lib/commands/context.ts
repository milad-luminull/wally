import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { EffectiveRole } from '@wally/shared';
import type { NoteDoc, WhiteboardDoc, WithId } from '../db/types.js';
import { AppError } from '../errors.js';
import { resolveRole } from '../authorization.js';

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
  db: Firestore;
  tx: Transaction;
  actor: Actor;
  board: WithId<WhiteboardDoc>;
  note: WithId<NoteDoc> | null;
  operationId: string;
  baseUrl: string;
}
export function requireAccess(
  board: WithId<WhiteboardDoc> | null,
  actorId: string,
  allowed: EffectiveRole[],
): EffectiveRole {
  const role = board && resolveRole(board, actorId);
  if (!board || !role) throw new AppError(404, 'NOT_FOUND', 'Not found');
  if (!allowed.includes(role)) throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
  return role;
}
export function revisionOf(value: { revision?: number }): number {
  return value.revision ?? 0;
}
export function notFound(): never {
  throw new AppError(404, 'NOT_FOUND', 'Not found');
}
