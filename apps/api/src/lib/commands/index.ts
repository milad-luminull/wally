import { createHash } from 'node:crypto';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import {
  boardCommandSchema,
  operationMetadataSchema,
  type BoardCommand,
  type EffectiveRole,
} from '@wally/shared';
import { notesCol, shareLinksCol, whiteboardsCol, withId } from '../db/collections.js';
import { AppError } from '../errors.js';
import { requireAccess, revisionOf, notFound, type Actor, type CommandResult } from './context.js';
import { executeNoteCommand } from './notes.js';
import { executeAdminCommand } from './administration.js';
import { drainCleanupJob } from './maintenance.js';

export type { Actor, CommandResult } from './context.js';
export interface CommandLogger {
  info(fields: Record<string, unknown>, message?: string): void;
  warn(fields: Record<string, unknown>, message?: string): void;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function rolesFor(command: BoardCommand): EffectiveRole[] {
  if (command.type === 'link.redeem') return ['OWNER', 'EDIT', 'VIEW'];
  return command.type.startsWith('note.') || command.type.startsWith('subtask.')
    ? ['OWNER', 'EDIT']
    : ['OWNER'];
}

/** The emulator can report an aborted query as INVALID_ARGUMENT with a closed
 * transaction, which SDK 7.x otherwise retries only for "transaction has expired".
 * Normalize just this transient condition; the SDK retries the complete transaction
 * with its existing bounded backoff. Invalid command arguments are never retried. */
function runCommandTransaction<T>(
  db: Firestore,
  command: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.runTransaction(async (tx) => {
    try {
      return await command(tx);
    } catch (error) {
      const failure = error as { code?: number; details?: string };
      if (failure.code === 3 && failure.details === 'Transaction is invalid or closed.') {
        throw Object.assign(new Error('Transaction was aborted'), { code: 10 });
      }
      throw error;
    }
  });
}

/** The only entry point for user-triggered board writes. No Fastify dependency. */
export async function executeBoardCommand(
  db: Firestore,
  actor: Actor,
  rawCommand: unknown,
  rawMetadata: unknown,
  options: { baseUrl?: string; logger?: CommandLogger } = {},
): Promise<CommandResult> {
  const parsed = boardCommandSchema.safeParse(rawCommand);
  if (!parsed.success) throw new AppError(400, 'BAD_REQUEST', 'Invalid command input');
  const metadata = operationMetadataSchema.safeParse(rawMetadata);
  if (!metadata.success)
    throw new AppError(
      428,
      'PRECONDITION_REQUIRED',
      'A valid operation ID and revision are required',
    );
  const command = parsed.data;
  const { operationId, expectedRevision } = metadata.data;
  const fingerprint = createHash('sha256')
    .update(canonical({ command, expectedRevision }))
    .digest('hex');
  const receiptRef = db
    .collection('users')
    .doc(actor.id)
    .collection('boardOperations')
    .doc(operationId);
  try {
    const { result, replayed } = await runCommandTransaction(db, async (tx) => {
      const receipt = (await tx.get(receiptRef)).data();
      // A committed deletion no longer has a target. Receipts carry its board so we can
      // re-authorize BEFORE replaying, without depending on the deleted document.
      if (receipt) {
        const board = withId(await tx.get(whiteboardsCol(db).doc(receipt.boardId)));
        requireAccess(board, actor.id, rolesFor(command));
        if (receipt.fingerprint !== fingerprint)
          throw new AppError(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            'Operation ID was already used for different input',
          );
        return { result: receipt.result as CommandResult, replayed: true };
      }

      const note =
        'noteId' in command ? withId(await tx.get(notesCol(db).doc(command.noteId))) : null;
      if ('noteId' in command && (!note || note.deletedAt)) notFound();
      const link =
        command.type === 'link.redeem'
          ? withId(await tx.get(shareLinksCol(db).doc(command.token)))
          : null;
      const boardId =
        note?.whiteboardId ?? ('boardId' in command ? command.boardId : link?.whiteboardId);
      if (!boardId || ('boardId' in command && command.boardId && command.boardId !== boardId))
        notFound();
      const board = withId(await tx.get(whiteboardsCol(db).doc(boardId)));
      if (!board) notFound();
      if (command.type === 'link.redeem') {
        if (!link || board.shareLinkToken !== command.token) notFound();
      } else requireAccess(board, actor.id, rolesFor(command));

      if (command.type !== 'note.create' && command.type !== 'link.redeem') {
        if (expectedRevision === undefined)
          throw new AppError(428, 'PRECONDITION_REQUIRED', 'Expected revision is required');
        if (expectedRevision !== revisionOf(note ?? board))
          throw new AppError(
            409,
            'STALE_REVISION',
            'The resource changed; review the latest version before saving',
          );
      }
      const context = {
        db,
        tx,
        actor,
        board,
        note,
        operationId,
        baseUrl: options.baseUrl ?? 'http://localhost',
      };
      const result =
        command.type.startsWith('note.') || command.type.startsWith('subtask.')
          ? await executeNoteCommand(context, command)
          : await executeAdminCommand(context, command);
      tx.create(receiptRef, {
        fingerprint,
        boardId,
        result,
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86400000),
      });
      return { result, replayed: false };
    });
    options.logger?.info({
      command: command.type,
      operationId,
      boardId: result.boardId,
      outcome: replayed ? 'replayed' : 'committed',
    });
    if (result.cleanupId) {
      try {
        await drainCleanupJob(db, result.cleanupId);
      } catch {
        options.logger?.warn({
          command: command.type,
          operationId,
          cleanupId: result.cleanupId,
          outcome: 'cleanup_pending',
        });
      }
    }
    return result;
  } catch (error) {
    options.logger?.warn({
      command: command.type,
      operationId,
      outcome: error instanceof AppError ? error.code : 'failed',
    });
    throw error;
  }
}
