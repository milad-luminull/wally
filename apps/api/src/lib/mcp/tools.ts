import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import { noteListQuerySchema } from '@wally/shared';
import type { Actor } from '../commands/context.js';
import { getBoard, getNote, listBoards, listMembers, listNotes } from '../commands/queries.js';
import { operationInputs, type OperationAnnotations } from '../assistant/operations.js';
import { runOperation, type OperationResult } from '../assistant/run.js';
import { AppError } from '../errors.js';

/** The transport supplies trusted identity and checks durable consent on every call. */
export interface McpToolContext {
  db: Firestore;
  actor: Actor;
  connectionId: string;
  scopes: string[];
  authorizeBoard: (boardId: string, write: boolean) => Promise<void>;
  authorizeWrite?: (tx: Transaction, boardId: string) => Promise<void>;
}
const operationId = z.string().uuid();
export const mcpToolInputs = {
  list_boards: z.object({}).strict(),
  get_board: operationInputs.list_members,
  list_notes: operationInputs.list_notes.extend({
    visibility: noteListQuerySchema.shape.visibility,
    field: noteListQuerySchema.shape.field,
    cursor: z.string().min(1).max(2048).optional(),
  }),
  get_note: operationInputs.get_note,
  list_members: operationInputs.list_members,
  create_note: operationInputs.create_note.extend({ operationId }),
  update_note: operationInputs.update_note.extend({ operationId }),
  move_note: operationInputs.move_note.extend({ operationId }),
  complete_note: operationInputs.complete_note.extend({ operationId }),
  reopen_note: operationInputs.reopen_note.extend({ operationId }),
  add_subtask: operationInputs.add_subtask.extend({ operationId }),
  toggle_subtask: operationInputs.toggle_subtask.extend({ operationId }),
  assign_note: operationInputs.assign_note.extend({ operationId }),
} as const;
export type McpToolName = keyof typeof mcpToolInputs;
export const mcpToolNames = Object.keys(mcpToolInputs) as McpToolName[];
const descriptions: Record<McpToolName, string> = {
  list_boards: 'List your currently accessible boards, including your role.',
  get_board: 'Read metadata, revision and assistant availability for a board you can access.',
  list_notes:
    'List visible notes with app filters, at most 100 per page. Pass nextCursor with identical filters and board to continue. Pages are live offset views: concurrent edits can cause skips or repeats; restart traversal for a fresh view.',
  get_note: 'Read a visible note on the selected board, including subtasks and history.',
  list_members: 'List board members and the board revision.',
  create_note:
    'Create a note. Reuse the same operationId UUID and identical input after a lost response; a new UUID creates a new note. Never suggest or choose colour automatically.',
  update_note:
    'Update explicitly requested note fields at expectedRevision. Never suggest or choose colour automatically. Retry identical input and operationId after a lost response.',
  move_note:
    'Move a note by horizon, priority or position at expectedRevision. Retry with the same operationId and input.',
  complete_note: 'Complete a note at expectedRevision. Retry with the same operationId and input.',
  reopen_note: 'Reopen a note at expectedRevision. Retry with the same operationId and input.',
  add_subtask:
    'Add a subtask at the parent note expectedRevision. Retry identical input and operationId to avoid duplicates.',
  toggle_subtask:
    'Set subtask completion at the parent note expectedRevision. Retry with the same operationId and input.',
  assign_note:
    'Assign a note to a current member, or clear assignment, at expectedRevision. Retry with the same operationId and input.',
};
const isRead = (name: McpToolName) => name.startsWith('list_') || name.startsWith('get_');
export const mcpToolDefinitions = mcpToolNames.map((name) => ({
  name,
  description: descriptions[name],
  inputSchema: mcpToolInputs[name],
  annotations: {
    readOnlyHint: isRead(name),
    destructiveHint: false,
    idempotentHint: true,
  } satisfies OperationAnnotations,
}));
export function availableMcpTools(scopes: string[]) {
  return mcpToolDefinitions.filter(
    (tool) =>
      scopes.includes('wally:read') &&
      (tool.annotations.readOnlyHint || scopes.includes('wally:write')),
  );
}
const invalid = () => new AppError(400, 'BAD_REQUEST', 'Invalid tool input or cursor');

/** Opaque continuation bound to identity, connection, board and canonical parsed filters.
 * It is not an authorization credential: every page rechecks current access and privacy. */
function pageBinding(context: McpToolContext, filters: unknown) {
  return createHash('sha256')
    .update(JSON.stringify([context.actor.id, context.connectionId, filters]))
    .digest('hex');
}
function readOffset(cursor: string | undefined, binding: string): number {
  if (!cursor) return 0;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const parsed = z
      .object({
        version: z.literal(1),
        binding: z.literal(binding),
        offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .safeParse(value);
    if (!parsed.success) throw invalid();
    return parsed.data.offset;
  } catch {
    throw invalid();
  }
}
export async function runMcpTool(
  context: McpToolContext,
  rawName: string,
  rawArgs: unknown,
): Promise<OperationResult> {
  if (!Object.hasOwn(mcpToolInputs, rawName)) throw invalid();
  const name = rawName as McpToolName;
  const parsed = mcpToolInputs[name].safeParse(rawArgs);
  if (!parsed.success) throw invalid();
  if (
    !context.scopes.includes('wally:read') ||
    (!isRead(name) && !context.scopes.includes('wally:write'))
  )
    throw new AppError(403, 'FORBIDDEN', 'Connection scope does not allow this tool');
  if (name === 'list_boards') {
    const boards = await listBoards(context.db, context.actor);
    const allowed = [];
    for (const board of boards) {
      try {
        await context.authorizeBoard(board.id, false);
      } catch (error) {
        if (error instanceof AppError && (error.statusCode === 403 || error.statusCode === 404))
          continue;
        throw error;
      }
      allowed.push(board);
    }
    return { data: allowed, revision: null };
  }
  const args = parsed.data as { boardId: string };
  await context.authorizeBoard(args.boardId, !isRead(name));
  const { db, actor } = context;
  if (name === 'get_board') {
    const board = await getBoard(db, actor, args.boardId);
    return { data: board, revision: board.revision };
  }
  if (name === 'list_members') return listMembers(db, actor, args.boardId);
  if (name === 'get_note') {
    const input = args as z.infer<typeof mcpToolInputs.get_note>;
    const note = await getNote(db, actor, input.noteId, input.boardId);
    return { data: note, revision: note.revision };
  }
  if (name === 'list_notes') {
    const { cursor, limit, boardId, ...filters } = args as z.infer<typeof mcpToolInputs.list_notes>;
    const binding = pageBinding(context, { boardId, limit, ...filters });
    const offset = readOffset(cursor, binding);
    const notes = await listNotes(db, actor, boardId, filters);
    // The shared query defines due/created ordering. Id breaks ties deterministically.
    notes.sort(
      (a, b) =>
        (a.dueDate === b.dueDate
          ? 0
          : a.dueDate === null
            ? 1
            : b.dueDate === null
              ? -1
              : a.dueDate.localeCompare(b.dueDate)) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
    const end = offset + limit;
    return {
      data: {
        notes: notes.slice(offset, end),
        nextCursor:
          end < notes.length
            ? Buffer.from(JSON.stringify({ version: 1, binding, offset: end })).toString(
                'base64url',
              )
            : null,
        total: notes.length,
      },
      revision: null,
    };
  }
  const { operationId: writeId, ...input } = args as { boardId: string; operationId: string };
  return runOperation(
    {
      db,
      actor,
      boardId: args.boardId,
      assistantEnabled: true,
      provenance: { via: 'mcp', connectionId: context.connectionId },
      authorize: context.authorizeWrite,
    },
    { name, input, operationId: writeId },
  );
}
