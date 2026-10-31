import { assertAssistantBoardActive } from './guards.js';
import { and, eq } from 'drizzle-orm';
import type { AssistantConversationDto, AssistantEntry } from '@wally/shared';
import type { Actor } from '../commands/index.js';
import { listNotes } from '../commands/queries.js';
import { AppError } from '../errors.js';
import { newId } from '../db/ids.js';
import type { AssistantConversationRow } from '../db/types.js';
import type { Database } from '../postgres/client.js';
import { withTransaction } from '../postgres/transaction.js';
import { assistantConversations } from '../postgres/schema/index.js';
import type { StoredMessage, TurnUsage } from './model/index.js';

export const MAX_TURNS = 20;
/** The bound on one conversation's stored model history, so a row stays small. */
export const MAX_MESSAGES_BYTES = 512 * 1024;
export const CONVERSATION_RETENTION_DAYS = 30;

const ZERO_USAGE: TurnUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};
const expiry = (lastTurnAt: Date) =>
  new Date(lastTurnAt.getTime() + CONVERSATION_RETENTION_DAYS * 86_400_000);

export async function createConversation(
  db: Database,
  userId: string,
  boardId: string,
  model: string,
  now: Date,
): Promise<AssistantConversationRow> {
  return withTransaction(db, async (tx) => {
    await assertAssistantBoardActive(tx, userId, boardId);
    const [row] = await tx
      .insert(assistantConversations)
      .values({
        id: newId(),
        userId,
        boardId,
        model,
        status: 'OPEN',
        turns: 0,
        messages: [],
        entries: [],
        usage: ZERO_USAGE,
        toolCalls: 0,
        createdAt: now,
        lastTurnAt: now,
        expiresAt: expiry(now),
      })
      .returning();
    return row!;
  });
}

/** Null unless the conversation belongs to this user on this board: the access recheck of §3.4. */
export async function loadConversation(
  db: Database,
  userId: string,
  boardId: string,
  id: string,
): Promise<AssistantConversationRow | null> {
  const [row] = await db
    .select()
    .from(assistantConversations)
    .where(and(eq(assistantConversations.userId, userId), eq(assistantConversations.id, id)));
  return row && row.boardId === boardId ? row : null;
}

/** An entry as stored: its instant normalized to the ISO form toIsoString writes. */
function toStoredEntry(entry: AssistantEntry): AssistantEntry {
  return { ...entry, at: new Date(entry.at).toISOString() };
}

/** UTF-8 bytes of the stored history, the unit MAX_MESSAGES_BYTES bounds. */
export function messagesBytes(messages: readonly unknown[]): number {
  return Buffer.byteLength(JSON.stringify(messages), 'utf8');
}

/**
 * Records one turn: both entries always; the model messages and usage only when the turn
 * completed (a stopped turn keeps the previous history). Closes the conversation at the
 * turn cap, or when the new history would exceed MAX_MESSAGES_BYTES: then the previous
 * history is kept, so the row never grows past the bound.
 *
 * `expectedTurns` is the turn count the caller loaded before running the model. The
 * transaction refuses with 409 ASSISTANT_CONVERSATION_CLOSED when the conversation is no
 * longer OPEN, and with 409 ASSISTANT_TURN_CONFLICT when another turn was recorded since (a
 * second tab, say: the conversation is still open, so the client reloads it rather than
 * abandoning it). Concurrent turns on one conversation cannot overwrite each other's history
 * or record a turn past MAX_TURNS.
 */
export async function appendTurn(
  db: Database,
  userId: string,
  id: string,
  turn: {
    expectedTurns: number;
    expectedBoardRevision?: number;
    user: AssistantEntry;
    assistant: AssistantEntry;
    messages: StoredMessage[] | null;
    usage: TurnUsage | null;
    toolCalls: number;
    now: Date;
  },
): Promise<AssistantConversationRow> {
  return withTransaction(db, async (tx) => {
    const [current] = await tx
      .select()
      .from(assistantConversations)
      .where(and(eq(assistantConversations.userId, userId), eq(assistantConversations.id, id)));
    if (!current) throw new AppError(404, 'NOT_FOUND', 'Not found');
    await assertAssistantBoardActive(tx, userId, current.boardId, turn.expectedBoardRevision);
    if (current.status !== 'OPEN')
      throw new AppError(409, 'ASSISTANT_CONVERSATION_CLOSED', 'This conversation is closed');
    if (current.turns !== turn.expectedTurns)
      throw new AppError(
        409,
        'ASSISTANT_TURN_CONFLICT',
        'Another turn was recorded on this conversation',
      );
    const tooBig = turn.messages !== null && messagesBytes(turn.messages) > MAX_MESSAGES_BYTES;
    const messages = tooBig ? current.messages : (turn.messages ?? current.messages);
    const usage = turn.usage ?? ZERO_USAGE;
    const turns = current.turns + 1;
    const next: AssistantConversationRow = {
      ...current,
      status: turns >= MAX_TURNS || tooBig ? 'CLOSED' : 'OPEN',
      turns,
      messages,
      entries: [...current.entries, toStoredEntry(turn.user), toStoredEntry(turn.assistant)],
      usage: {
        inputTokens: current.usage.inputTokens + usage.inputTokens,
        cachedInputTokens: current.usage.cachedInputTokens + usage.cachedInputTokens,
        outputTokens: current.usage.outputTokens + usage.outputTokens,
        reasoningTokens: current.usage.reasoningTokens + usage.reasoningTokens,
      },
      toolCalls: current.toolCalls + turn.toolCalls,
      lastTurnAt: turn.now,
      expiresAt: expiry(turn.now),
    };
    await tx
      .update(assistantConversations)
      .set({
        status: next.status,
        turns: next.turns,
        messages: next.messages,
        entries: next.entries,
        usage: next.usage,
        toolCalls: next.toolCalls,
        lastTurnAt: next.lastTurnAt,
        expiresAt: next.expiresAt,
      })
      .where(eq(assistantConversations.id, id));
    return next;
  });
}

export function toConversationDto(doc: AssistantConversationRow): AssistantConversationDto {
  return {
    id: doc.id,
    boardId: doc.boardId,
    status: doc.status,
    model: doc.model,
    entries: doc.entries,
  };
}

/**
 * The DTO with every stored chip checked against what the caller can see now (RFC-0003-wally-agent.md
 * §3.2: chips are checked at render time). A chip for a note since made private, deleted or
 * otherwise out of the caller's sight is dropped; the entry's text stays as it was answered.
 */
export async function toVisibleConversationDto(
  db: Database,
  actor: Actor,
  doc: AssistantConversationRow,
): Promise<AssistantConversationDto> {
  const dto = toConversationDto(doc);
  if (!dto.entries.some((entry) => entry.chips.length > 0)) return dto;
  const visible = new Set(
    (await listNotes(db, actor, doc.boardId, { status: 'ALL' })).map((note) => note.id),
  );
  return {
    ...dto,
    entries: dto.entries.map((entry) => ({
      ...entry,
      chips: entry.chips.filter((chip) => visible.has(chip.id)),
    })),
  };
}
