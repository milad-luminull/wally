import { visibleLinks } from '../visibleLinks.js';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  boardCommandSchema,
  operationMetadataSchema,
  type BoardCommand,
  type EffectiveRole,
} from '@wally/shared';
import { liveBoard, loadNote } from '../db/records.js';
import { AppError } from '../errors.js';
import { ASSISTANT_AUDIT_RETENTION_DAYS, type Provenance } from '../assistant/provenance.js';
import type { Note } from '../db/types.js';
import type { Database } from '../postgres/client.js';
import { withTransaction, type Transaction } from '../postgres/transaction.js';
import { assistantAudit, boardOperations, shareLinks } from '../postgres/schema/index.js';
import { requireAccess, notFound, type Actor, type CommandResult } from './context.js';
import { canSeeNote } from '../notes.js';
import { executeNoteCommand } from './notes.js';
import { createBoard, executeAdminCommand } from './administration.js';
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
const ANY_ROLE: EffectiveRole[] = ['OWNER', 'EDIT', 'VIEW'];
const EDITORS: EffectiveRole[] = ['OWNER', 'EDIT'];

/**
 * Who may run `command`. A member's own private note is theirs whatever their board role,
 * so a VIEW member can keep private notes. Changing who sees a note is the exception: it
 * adds to or removes from what the shared board shows, so it always needs EDIT or OWNER.
 */
function rolesFor(
  command: BoardCommand,
  note: Note | null,
  actorId: string,
): EffectiveRole[] {
  if (command.type === 'link.redeem') return ANY_ROLE;
  // A member leaves; the owner cannot (they delete instead), so OWNER is a 403 here.
  if (command.type === 'board.leave') return ['EDIT', 'VIEW'];
  if (!command.type.startsWith('note.') && !command.type.startsWith('subtask.')) return ['OWNER'];
  if (command.type === 'note.create')
    return command.input.visibility === 'PRIVATE' ? ANY_ROLE : EDITORS;
  if (command.type === 'note.update' && command.input.visibility !== undefined) return EDITORS;
  return note?.visibility === 'PRIVATE' && note.createdById === actorId ? ANY_ROLE : EDITORS;
}

/** The only entry point for user-triggered board writes. No Fastify dependency. */
export async function executeBoardCommand(
  db: Database,
  actor: Actor,
  rawCommand: unknown,
  rawMetadata: unknown,
  options: {
    baseUrl?: string;
    logger?: CommandLogger;
    provenance?: Provenance;
    /** Additional trusted authorization reads participate in this write transaction. */
    authorize?: (tx: Transaction, boardId: string) => Promise<void>;
  } = {},
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
  const { provenance } = options;
  // Provenance joins the fingerprint only when present, so a browser command's fingerprint
  // is the same with or without the field.
  const fingerprint = createHash('sha256')
    .update(
      canonical(
        provenance ? { command, expectedRevision, provenance } : { command, expectedRevision },
      ),
    )
    .digest('hex');
  try {
    const { result, replayed } = await withTransaction(db, async (tx) => {
      // `roles` are the ones that authorized the command; replay re-checks the caller's
      // current role against them, so a viewer's retried private-note write still replays.
      // An assistant write also leaves its audit record, in the same transaction.
      const writeReceipt = async (
        boardId: string,
        result: CommandResult,
        roles: EffectiveRole[],
      ) => {
        const createdAt = new Date();
        await tx.insert(boardOperations).values({
          userId: actor.id,
          operationId,
          fingerprint,
          boardId,
          roles,
          result,
          provenance: provenance ?? null,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + 7 * 86400000),
        });
        if (provenance) {
          const occurredAt = createdAt;
          await tx.insert(assistantAudit).values({
            operationId,
            actorId: actor.id,
            boardId,
            // Only note.create targets a note it has no id for yet; board and member
            // results carry their own ids, which are not a target note.
            targetId:
              'noteId' in command
                ? command.noteId
                : command.type === 'note.create'
                  ? (result.data as { id: string }).id
                  : null,
            commandType: command.type,
            ...(provenance.via === 'assistant'
              ? { conversationId: provenance.conversationId, approvalId: provenance.approvalId }
              : { via: 'mcp' as const, connectionId: provenance.connectionId }),
            revision: result.revision,
            occurredAt,
            expiresAt: new Date(
              occurredAt.getTime() + ASSISTANT_AUDIT_RETENTION_DAYS * 86400000,
            ),
          });
        }
      };
      const [receipt] = await tx
        .select()
        .from(boardOperations)
        .where(
          and(eq(boardOperations.userId, actor.id), eq(boardOperations.operationId, operationId)),
        );
      // A committed deletion no longer has a target. Receipts carry its board so we can
      // re-authorize BEFORE replaying, without depending on the deleted row.
      if (receipt) {
        const board = await liveBoard(tx, receipt.boardId);
        await options.authorize?.(tx, receipt.boardId);
        requireAccess(board, actor.id, receipt.roles);
        if (receipt.fingerprint !== fingerprint)
          throw new AppError(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            'Operation ID was already used for different input',
          );
        // A note may have become private since the original response. Recheck its
        // current visibility before disclosing a cached result (deletions have no target).
        const targetId =
          'noteId' in command
            ? command.noteId
            : command.type === 'note.create'
              ? (receipt.result.data as { id?: string } | null)?.id
              : undefined;
        if (targetId && command.type !== 'note.delete') {
          const target = await loadNote(tx, targetId);
          if (
            !target ||
            target.deletedAt ||
            target.boardId !== receipt.boardId ||
            !canSeeNote(target, actor.id)
          )
            notFound();
        }
        return { result: receipt.result, replayed: true };
      }

      // The only command with no existing board to resolve, authorize or check a revision on.
      // Its receipt names the new board, so a replay re-authorizes the caller as its owner.
      if (command.type === 'board.create') {
        const result = await createBoard(tx, actor, command.input.name);
        await writeReceipt(result.boardId, result, rolesFor(command, null, actor.id));
        return { result, replayed: false };
      }

      const note = 'noteId' in command ? await loadNote(tx, command.noteId) : null;
      if ('noteId' in command && (!note || note.deletedAt)) notFound();
      // Before any role check, so a non-creator learns nothing from a private note's id.
      if (note && !canSeeNote(note, actor.id)) notFound();
      const [link] =
        command.type === 'link.redeem'
          ? await tx.select().from(shareLinks).where(eq(shareLinks.token, command.token))
          : [];
      const boardId = note?.boardId ?? ('boardId' in command ? command.boardId : link?.boardId);
      if (!boardId || ('boardId' in command && command.boardId && command.boardId !== boardId))
        notFound();
      const board = await liveBoard(tx, boardId);
      if (!board) notFound();
      await options.authorize?.(tx, boardId);
      const roles = rolesFor(command, note, actor.id);
      if (command.type === 'link.redeem') {
        if (!link || board.shareLinkToken !== command.token) notFound();
      } else requireAccess(board, actor.id, roles);

      // board.leave states a fact about the caller, not an edit of the board: a concurrent
      // rename by the owner must not turn it into a 409 the member cannot resolve.
      if (
        command.type !== 'note.create' &&
        command.type !== 'link.redeem' &&
        command.type !== 'board.leave'
      ) {
        if (expectedRevision === undefined)
          throw new AppError(428, 'PRECONDITION_REQUIRED', 'Expected revision is required');
        if (expectedRevision !== (note ?? board).revision)
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
        provenance,
      };
      const result =
        command.type.startsWith('note.') || command.type.startsWith('subtask.')
          ? await executeNoteCommand(context, command)
          : await executeAdminCommand(context, command);
      await writeReceipt(boardId, result, roles);
      return { result, replayed: false };
    });
    options.logger?.info({
      command: command.type,
      operationId,
      boardId: result.boardId,
      outcome: replayed ? 'replayed' : 'committed',
      ...(provenance ? { via: provenance.via } : {}),
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
    // Receipts preserve the original result, but target visibility may have changed since.
    if (
      command.type.startsWith('note.') &&
      result.data &&
      typeof result.data === 'object' &&
      'links' in result.data
    ) {
      const note = result.data as { whiteboardId: string; links: string[] };
      return {
        ...result,
        data: {
          ...note,
          links: await visibleLinks(db, { boardId: note.whiteboardId, links: note.links }, actor.id),
        },
      };
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
