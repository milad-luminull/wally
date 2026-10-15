import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { AssistantConversationDto, AssistantEntry } from '@wally/shared';
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
  await ref.create(doc);
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

export async function latestOpenConversation(
  db: Firestore,
  userId: string,
  boardId: string,
): Promise<WithId<AssistantConversationDoc> | null> {
  // Two equality filters need no composite index; the sort is done here.
  const open = docsWithId(
    await assistantConversationsCol(db, userId)
      .where('boardId', '==', boardId)
      .where('status', '==', 'OPEN')
      .get(),
  );
  open.sort((a, b) => b.lastTurnAt.toMillis() - a.lastTurnAt.toMillis());
  return open[0] ?? null;
}

function toEntryDoc(entry: AssistantEntry): AssistantEntryDoc {
  return { ...entry, at: Timestamp.fromDate(new Date(entry.at)) };
}

/**
 * Records one turn: both entries always; the model messages and usage only when the turn
 * completed (a stopped turn keeps the previous history). Closes the conversation at the
 * turn cap or when the stored messages approach the document limit.
 */
export async function appendTurn(
  db: Firestore,
  userId: string,
  id: string,
  turn: {
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
    if (!current) throw new Error(`Conversation ${id} not found`);
    const messages = turn.messages ?? current.messages;
    const usage = turn.usage ?? ZERO_USAGE;
    const turns = current.turns + 1;
    const tooBig = JSON.stringify(messages).length > MAX_MESSAGES_BYTES;
    const next: WithId<AssistantConversationDoc> = {
      ...current,
      status: turns >= MAX_TURNS || tooBig ? 'CLOSED' : current.status,
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
