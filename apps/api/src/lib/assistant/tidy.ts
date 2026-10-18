import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { TIDY_MAX_MOVES, type TidyDecision, type TidyDto, type TidyRequest } from '@wally/shared';
import type { Actor } from '../commands/index.js';
import { listNotes } from '../commands/queries.js';
import {
  assistantSuggestionsCol,
  assistantTidiesCol,
  docsWithId,
  stripId,
  toIso,
  withId,
} from '../db/collections.js';
import type { AssistantTidyDoc, WithId } from '../db/types.js';
import { AppError } from '../errors.js';
import { estimateTokens } from './budget/estimate.js';
import { reserveAttempt, settleAttempt } from './budget/ledger.js';
import { priceFor } from './budget/prices.js';
import { tidySchemaJson, type TidyRunner } from './model/index.js';
import {
  SUGGESTION_RETENTION_DAYS,
  type SuggestionContext,
  type SuggestionDeps,
} from './suggestions.js';
import { acceptModelMoves, mayMoveFor, tidyCandidates, type PlannedMove } from './tidyPlan.js';
import { buildTidyInstructions, buildTidyPrompt } from './tidyPrompt.js';

export const TIDY_MAX_OUTPUT_TOKENS = 512;
export const TIDY_DEADLINE_MS = 20_000;

/** A tidy also calls the model (for the undated notes); a decision never does. */
export interface TidyDeps extends SuggestionDeps {
  runner: TidyRunner;
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found');
const settled = () => new AppError(409, 'ASSISTANT_TIDY_SETTLED', 'This tidy was already decided');

export function toTidyDto(doc: WithId<AssistantTidyDoc>): TidyDto {
  return {
    id: doc.id,
    boardId: doc.boardId,
    status: doc.status,
    moves: doc.moves.map(({ operationIds: _ids, ...move }) => move),
    kept: doc.applied
      ? { noteIds: doc.applied.moves.map((m) => m.noteId), skipped: doc.applied.skipped }
      : null,
    createdAt: toIso(doc.createdAt),
  };
}

/** The caller's own record on this board, or 404 (the access recheck of WALLY_AGENT.md §3.4). */
export async function loadTidy(
  db: Firestore,
  actor: Actor,
  boardId: string,
  id: string,
): Promise<WithId<AssistantTidyDoc>> {
  const doc = withId(await assistantTidiesCol(db, actor.id).doc(id).get());
  if (!doc || doc.boardId !== boardId) throw notFound();
  return doc;
}

/**
 * Claims the record for one decision in a transaction, as a suggestion's `claim` does: two
 * tabs deciding at once agree on one outcome, the second replays the first's.
 */
export async function claimTidy(
  db: Firestore,
  actor: Actor,
  boardId: string,
  id: string,
  from: AssistantTidyDoc['status'],
  to: AssistantTidyDoc['status'],
  decision: { source: string; noteIds: string[] },
  now: Date,
): Promise<{ doc: WithId<AssistantTidyDoc>; claimed: boolean }> {
  const ref = assistantTidiesCol(db, actor.id).doc(id);
  return db.runTransaction(async (tx) => {
    const current = withId(await tx.get(ref));
    if (!current || current.boardId !== boardId) throw notFound();
    if (current.status === to) return { doc: current, claimed: false };
    if (current.status !== from) throw settled();
    const stamp = Timestamp.fromDate(now);
    const next: WithId<AssistantTidyDoc> = {
      ...current,
      status: to,
      ...(to === 'UNDONE'
        ? { undone: { source: decision.source, at: stamp } }
        : { decision: { ...decision, at: stamp } }),
      updatedAt: stamp,
    };
    tx.set(ref, stripId(next));
    return { doc: next, claimed: true };
  });
}

/** Every pending tidy of this caller on this board is discarded: one proposal at a time (R9). */
async function discardPending(db: Firestore, actor: Actor, boardId: string, now: Date) {
  const pending = docsWithId(
    await assistantTidiesCol(db, actor.id)
      .where('boardId', '==', boardId)
      .where('status', '==', 'PENDING')
      .get(),
  );
  if (pending.length === 0) return;
  const stamp = Timestamp.fromDate(now);
  const col = assistantTidiesCol(db, actor.id);
  await db.runTransaction(async (tx) => {
    for (const snap of await tx.getAll(...pending.map((doc) => col.doc(doc.id))))
      if (snap.data()?.status === 'PENDING')
        tx.update(snap.ref, { status: 'DISCARDED', updatedAt: stamp });
  });
}

/** The notes with a pending Wallybot change: one pending change per note (R2). */
async function notesWithPendingSuggestion(
  db: Firestore,
  actor: Actor,
  boardId: string,
): Promise<Set<string>> {
  const docs = await assistantSuggestionsCol(db, actor.id)
    .where('boardId', '==', boardId)
    .where('status', '==', 'PENDING')
    .get();
  return new Set(docs.docs.map((snap) => snap.data().noteId));
}

/**
 * One Tidy (WALLYBOT_INLINE.md §3.5, plan R3): read the open notes, move the dated ones by the
 * rule, ask the model about the undated ones in Today (reserve, call, settle), and store the
 * batch only when there is something to move. Throws BudgetError and AppError only; the
 * provider's own error becomes 502 without its wording.
 */
export async function proposeTidy(
  deps: TidyDeps,
  ctx: SuggestionContext,
  request: TidyRequest,
): Promise<TidyDto | null> {
  const clock = () => deps.now?.() ?? new Date();
  const { db, env } = deps;
  const { actor, board } = ctx;
  const now = clock();
  await discardPending(db, actor, board.id, now);

  const notes = await listNotes(db, actor, board.id, { status: 'OPEN' });
  const busy = await notesWithPendingSuggestion(db, actor, board.id);
  const { dated, undated } = tidyCandidates(
    notes.filter((note) => !busy.has(note.id)),
    request.today,
    mayMoveFor(ctx.role, actor.id),
  );
  if (dated.length === 0 && undated.length === 0) return null;

  let byWords: PlannedMove[] = [];
  let model: string | null = null;
  let usage: AssistantTidyDoc['usage'] = null;
  if (undated.length > 0) {
    const instructions = buildTidyInstructions({
      today: request.today,
      timeZone: request.timeZone,
      language: ctx.language,
    });
    const prompt = buildTidyPrompt(
      undated.map((note) => ({ id: note.id, title: note.title, text: note.description })),
    );
    const schema = await tidySchemaJson();
    model = env.ASSISTANT_MODEL;
    const price = priceFor(model);
    const caps = {
      dailyTokens: env.ASSISTANT_DAILY_CAP_TOKENS,
      monthlyMicroUsd: env.ASSISTANT_MONTHLY_CAP_MICRO_USD,
    };
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), deps.deadlineMs ?? TIDY_DEADLINE_MS);
    const startedAt = Date.now();
    let output;
    try {
      output = await deps.runner({
        instructions,
        prompt,
        maxOutputTokens: TIDY_MAX_OUTPUT_TOKENS,
        abortSignal: controller.signal,
        onAttempt: async (info) => {
          const reservation = await reserveAttempt(db, {
            userId: actor.id,
            now: clock(),
            estimate: {
              inputTokens: estimateTokens([instructions, prompt, schema]) + 16,
              outputTokens: info.maxOutputTokens,
            },
            price,
            caps,
          });
          return {
            settle: (used) =>
              settleAttempt(
                db,
                actor.id,
                reservation.attemptId,
                { inputTokens: used.inputTokens, outputTokens: used.outputTokens },
                clock(),
              ),
          };
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      deps.logger?.warn({
        type: 'assistant.provider_error',
        boardId: board.id,
        name: (error as { name?: unknown } | null)?.name,
        status: (error as { statusCode?: unknown } | null)?.statusCode,
      });
      throw new AppError(502, 'ASSISTANT_PROVIDER_ERROR', 'The model provider failed');
    } finally {
      clearTimeout(deadline);
    }
    deps.logger?.info({
      type: 'assistant.tidy',
      boardId: board.id,
      undated: undated.length,
      proposed: output.moves?.moves.length ?? 0,
      usage: output.usage,
      ms: Date.now() - startedAt,
    });
    usage = {
      inputTokens: output.usage?.inputTokens ?? 0,
      outputTokens: output.usage?.outputTokens ?? 0,
    };
    if (output.moves) byWords = acceptModelMoves(output.moves.moves, undated);
  }

  // At most what one batch may carry: dated moves first, earliest due first (`listNotes` order).
  const moves = [...dated, ...byWords].slice(0, TIDY_MAX_MOVES);
  if (moves.length === 0) return null;
  const stamp = Timestamp.fromDate(now);
  const doc: AssistantTidyDoc = {
    boardId: board.id,
    status: 'PENDING',
    moves: moves.map((move) => ({
      ...move,
      operationIds: { apply: randomUUID(), undo: randomUUID() },
    })),
    decision: null,
    undone: null,
    applied: null,
    model,
    usage,
    createdAt: stamp,
    updatedAt: stamp,
    expiresAt: Timestamp.fromMillis(now.getTime() + SUGGESTION_RETENTION_DAYS * 86_400_000),
  };
  const ref = assistantTidiesCol(db, actor.id).doc();
  await ref.create(doc);
  return toTidyDto({ ...doc, id: ref.id });
}

/** Task 4 adds `decideTidy` below. */
export type { TidyDecision };
