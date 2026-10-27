import { assertAssistantBoardActive } from './guards.js';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { AssistantConversationDto, AssistantEntry } from '@wally/shared';
import type { Actor } from '../commands/index.js';
import { listNotes } from '../commands/queries.js';
import { AppError } from '../errors.js';
import {
  assistantConversationsCol,
  docsWithId,
  stripId,
  toIso,
  withId,
} from '../db/collections.js';
import type { AssistantConversationDoc, AssistantEntryDoc, WithId } from '../db/types.js';
import type { StoredMessage, TurnUsage } from './model/index.js';

export const MAX_TURNS = 20;
/** Half of Firestore's 1 MiB document limit, leaving room for entries and usage. */
export const MAX_MESSAGES_BYTES = 512 * 1024;
export const CONVERSATION_RETENTION_DAYS = 30;

const ZERO_USAGE: TurnUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};
const expiry = (lastTurnAt: Date) =>
  Timestamp.fromMillis(lastTurnAt.getTime() + CONVERSATION_RETENTION_DAYS * 86_400_000);

export async function createConversation(
  db: Firestore,
  userId: string,
  boardId: string,
  model: string,
  now: Date,
): Promise<WithId<AssistantConversationDoc>> {
  const ref = assistantConversationsCol(db, userId).doc();
  const stamp = Timestamp.fromDate(now);
  const doc: AssistantConversationDoc = {
    boardId,
    model,
    status: 'OPEN',
    turns: 0,
    messages: [],
    entries: [],
    usage: ZERO_USAGE,
    toolCalls: 0,
    createdAt: stamp,
    lastTurnAt: stamp,
    expiresAt: expiry(now),
  };
  await db.runTransaction(async (tx) => {
    await assertAssistantBoardActive(db, userId, boardId, tx);
    tx.create(ref, doc);
  });
  return { ...doc, id: ref.id };
}

/** Null unless the conversation belongs to this user on this board: the access recheck of §3.4. */
export async function loadConversation(
  db: Firestore,
  userId: string,
  boardId: string,
  id: string,
): Promise<WithId<AssistantConversationDoc> | null> {
  const doc = withId(await assistantConversationsCol(db, userId).doc(id).get());
  return doc && doc.boardId === boardId ? doc : null;
}

/**
 * The caller's most recent open conversation on the board with the deployment's current
 * model. One pinned to another model can no longer take a turn (it answers 409), so it is
 * not offered to continue.
 */
export async function latestOpenConversation(
  db: Firestore,
  userId: string,
  boardId: string,
  model: string,
): Promise<WithId<AssistantConversationDoc> | null> {
  // Two equality filters need no composite index; the model filter and the sort are done here.
  const open = docsWithId(
    await assistantConversationsCol(db, userId)
      .where('boardId', '==', boardId)
      .where('status', '==', 'OPEN')
      .get(),
  ).filter((conversation) => conversation.model === model);
  open.sort((a, b) => b.lastTurnAt.toMillis() - a.lastTurnAt.toMillis());
  return open[0] ?? null;
}

function toEntryDoc(entry: AssistantEntry): AssistantEntryDoc {
  return { ...entry, at: Timestamp.fromDate(new Date(entry.at)) };
}

/** UTF-8 bytes of the stored history, the unit Firestore counts against its document limit. */
export function messagesBytes(messages: readonly unknown[]): number {
  return Buffer.byteLength(JSON.stringify(messages), 'utf8');
}

/**
 * Records one turn: both entries always; the model messages and usage only when the turn
 * completed (a stopped turn keeps the previous history). Closes the conversation at the
 * turn cap, or when the new history would exceed MAX_MESSAGES_BYTES: then the previous
 * history is kept, so the document never grows past the bound.
 *
 * `expectedTurns` is the turn count the caller loaded before running the model. The
 * transaction refuses with 409 ASSISTANT_CONVERSATION_CLOSED when the conversation is no
 * longer OPEN, and with 409 ASSISTANT_TURN_CONFLICT when another turn was recorded since (a
 * second tab, say: the conversation is still open, so the client reloads it rather than
 * abandoning it). Concurrent turns on one conversation cannot overwrite each other's history
 * or record a turn past MAX_TURNS.
 */
export async function appendTurn(
  db: Firestore,
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
): Promise<WithId<AssistantConversationDoc>> {
  const ref = assistantConversationsCol(db, userId).doc(id);
  return db.runTransaction(async (tx) => {
    const current = withId(await tx.get(ref));
    if (!current) throw new AppError(404, 'NOT_FOUND', 'Not found');
    await assertAssistantBoardActive(db, userId, current.boardId, tx, turn.expectedBoardRevision);
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
    const next: WithId<AssistantConversationDoc> = {
      ...current,
      status: turns >= MAX_TURNS || tooBig ? 'CLOSED' : 'OPEN',
      turns,
      messages,
      entries: [...current.entries, toEntryDoc(turn.user), toEntryDoc(turn.assistant)],
      usage: {
        inputTokens: current.usage.inputTokens + usage.inputTokens,
        cachedInputTokens: current.usage.cachedInputTokens + usage.cachedInputTokens,
        outputTokens: current.usage.outputTokens + usage.outputTokens,
        reasoningTokens: current.usage.reasoningTokens + usage.reasoningTokens,
      },
      toolCalls: current.toolCalls + turn.toolCalls,
      lastTurnAt: Timestamp.fromDate(turn.now),
      expiresAt: expiry(turn.now),
    };
    tx.set(ref, stripId(next));
    return next;
  });
}

export function toConversationDto(doc: WithId<AssistantConversationDoc>): AssistantConversationDto {
  return {
    id: doc.id,
    boardId: doc.boardId,
    status: doc.status,
    model: doc.model,
    entries: doc.entries.map((e) => ({ ...e, at: toIso(e.at) })),
  };
}

/**
 * The DTO with every stored chip checked against what the caller can see now (WALLY_AGENT.md
 * §3.2: chips are checked at render time). A chip for a note since made private, deleted or
 * otherwise out of the caller's sight is dropped; the entry's text stays as it was answered.
 */
export async function toVisibleConversationDto(
  db: Firestore,
  actor: Actor,
  doc: WithId<AssistantConversationDoc>,
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
