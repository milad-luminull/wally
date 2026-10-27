import { assertAssistantBoardActive, assertAssistantNotesActive } from './guards.js';
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
import { trackAttempts } from './budget/ledger.js';
import { priceFor } from './budget/prices.js';
import { tidySchemaJson, type TidyRunner } from './model/index.js';
import { retryDelayMs, withOneRetry } from './model/retry.js';
import { runOperation, type OperationContext } from './run.js';
import {
  MIN_ATTEMPT_MS,
  SUGGESTION_RETENTION_DAYS,
  type SuggestionContext,
  type SuggestionDeps,
} from './suggestions.js';
import { acceptModelMoves, mayMoveFor, tidyCandidates, type PlannedMove } from './tidyPlan.js';
import { buildTidyInstructions, buildTidyPrompt } from './tidyPrompt.js';

/**
 * The answer's allowance, sized per call: room for the object itself, and for one move (an id,
 * a zone, a confidence and a reason of ten words) per undated note listed.
 */
export const TIDY_OUTPUT_TOKENS_BASE = 128;
export const TIDY_OUTPUT_TOKENS_PER_MOVE = 64;
/** As a capture's (SUGGESTION_DEADLINE_MS): sized to the model's slow hours. */
export const TIDY_DEADLINE_MS = 40_000;

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

/** The caller's own record on this board, or 404 (the access recheck of RFC-0003-wally-agent.md §3.4). */
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
    await assertAssistantBoardActive(db, actor.id, current.boardId, tx);
    if (current.status === to) return { doc: current, claimed: false };
    if (current.status !== from) throw settled();
    const stamp = Timestamp.fromDate(now);
    const next: WithId<AssistantTidyDoc> = {
      ...current,
      status: to,
      ...(to === 'UNDONE'
        ? { undone: { ...decision, at: stamp } }
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
        tx.update(snap.ref, {
          status: 'DISCARDED',
          // No person decided it: a newer tidy replaced it (R9).
          decision: { source: 'replaced', noteIds: [], at: stamp },
          updatedAt: stamp,
        });
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
 * One Tidy (RFC-0005-wallybot-inline.md §3.5, plan R3): read the open notes (those the request names,
 * when it names any), move the dated ones by the rule, ask the model about the undated ones in
 * Today (reserve, call, settle), and store the batch only when there is something to move. Throws BudgetError and AppError only; the
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

  const open = await listNotes(db, actor, board.id, { status: 'OPEN' });
  // A filtered wall names the notes it shows: a note it hides is neither moved by the date
  // rule nor read by the model.
  const only = request.only ? new Set(request.only) : null;
  const notes = only ? open.filter((note) => only.has(note.id)) : open;
  const busy = await notesWithPendingSuggestion(db, actor, board.id);
  const candidates = tidyCandidates(
    notes.filter((note) => !busy.has(note.id)),
    request.today,
    mayMoveFor(ctx.role, actor.id),
  );
  const { dated } = candidates;
  if (dated.length === 0 && candidates.undated.length === 0) return null;
  // The model reads only the undated notes the batch has room for after the dated moves; a
  // batch the dated moves fill asks it nothing (the newest undated notes go first).
  const undated = candidates.undated.slice(0, Math.max(0, TIDY_MAX_MOVES - dated.length));

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
    const deadlineMs = deps.deadlineMs ?? TIDY_DEADLINE_MS;
    const deadline = setTimeout(() => controller.abort(), deadlineMs);
    const startedAt = Date.now();
    const attempts = trackAttempts(db, actor.id, {
      clock,
      // The slot then stays until its lease expires; said by shape only, like a provider error.
      onReleaseError: (error) =>
        deps.logger?.warn({
          type: 'assistant.release_failed',
          boardId: board.id,
          name: (error as { name?: unknown } | null)?.name,
          code: (error as { code?: unknown } | null)?.code,
        }),
    });
    let output;
    try {
      // A busy or failing provider gets one more try after a short pause, within the deadline.
      // Each try frees whatever slot it still holds before the next one reserves.
      output = await withOneRetry(
        () =>
          deps
            .runner({
              instructions,
              prompt,
              maxOutputTokens:
                TIDY_OUTPUT_TOKENS_BASE + TIDY_OUTPUT_TOKENS_PER_MOVE * undated.length,
              abortSignal: controller.signal,
              onAttempt: async (info) => {
                const { attemptId } = await attempts.reserve({
                  estimate: {
                    inputTokens: estimateTokens([instructions, prompt, schema]) + 16,
                    outputTokens: info.maxOutputTokens,
                  },
                  price,
                  caps,
                });
                return {
                  settle: (used) =>
                    attempts.settle(attemptId, {
                      inputTokens: used.inputTokens,
                      outputTokens: used.outputTokens,
                    }),
                  release: () => attempts.release(attemptId),
                };
              },
            })
            .finally(attempts.releaseRest),
        {
          signal: controller.signal,
          deadlineAt: startedAt + deadlineMs,
          minAttemptMs: MIN_ATTEMPT_MS,
          delayMs: retryDelayMs,
        },
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Our own deadline, not the provider's fault: said as a timeout.
      if (controller.signal.aborted) {
        deps.logger?.warn({
          type: 'assistant.timeout',
          boardId: board.id,
          ms: Date.now() - startedAt,
        });
        throw new AppError(504, 'ASSISTANT_TIMEOUT', 'The model did not answer in time');
      }
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
    if (output.moves) byWords = acceptModelMoves(output.moves.moves, undated, request.today);
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
  await db.runTransaction(async (tx) => {
    await assertAssistantBoardActive(db, actor.id, board.id, tx, board.revision ?? 0);
    await assertAssistantNotesActive(db, actor.id, board.id, tx, notes);
    tx.create(ref, doc);
  });
  return toTidyDto({ ...doc, id: ref.id });
}

function operationContext(
  deps: SuggestionDeps,
  ctx: SuggestionContext,
  id: string,
): OperationContext {
  return {
    db: deps.db,
    actor: ctx.actor,
    boardId: ctx.board.id,
    // The tidy is the approval record; a tidy has no conversation (as a suggestion, plan R2 of slice 2).
    provenance: { via: 'assistant', conversationId: id, approvalId: id },
    logger: deps.logger,
  };
}

/**
 * A refusal that a retry under the same id cannot change, and that is the note's, not the
 * server's: forbidden, gone, changed since, or a change the note cannot take. A 400 (or any
 * other status) means the server built a bad call: it is thrown, never taken for a skip.
 */
const FINAL_REFUSALS = new Set([403, 404, 409, 422]);
export const isFinalRefusal = (error: unknown): error is AppError =>
  error instanceof AppError && FINAL_REFUSALS.has(error.statusCode);

type TidyMoveDoc = AssistantTidyDoc['moves'][number];

/**
 * Moves the notes, each under its own operation id on the revision given, skipping the ones
 * the command layer refuses for good (changed since, gone, not the caller's to move) and
 * throwing on anything else, so the caller can resume later under the same ids. Returns what
 * moved, with the revision each move produced, and what was skipped (plan R5).
 */
async function moveEach(
  opCtx: OperationContext,
  moves: {
    move: TidyMoveDoc;
    to: TidyMoveDoc['to'];
    expectedRevision: number;
    operationId: string;
  }[],
): Promise<{ moved: { noteId: string; revision: number }[]; skipped: string[] }> {
  const moved: { noteId: string; revision: number }[] = [];
  const skipped: string[] = [];
  for (const { move, to, expectedRevision, operationId } of moves) {
    try {
      const result = await runOperation(opCtx, {
        name: 'move_note',
        input: {
          boardId: opCtx.boardId,
          noteId: move.noteId,
          expectedRevision,
          input: { mode: 'HORIZON', horizon: to },
        },
        operationId,
      });
      moved.push({ noteId: move.noteId, revision: result.revision ?? expectedRevision });
    } catch (error) {
      if (!isFinalRefusal(error)) throw error;
      skipped.push(move.noteId);
    }
  }
  return { moved, skipped };
}

/**
 * Finishes a claimed keep: every keep of a KEPT record with nothing applied comes here (the
 * claiming tab, a second tab, a repeat after a cut-short keep) and runs the same moves under
 * the record's apply ids, so each note moves once and each move leaves one audit row.
 */
async function completeKeep(
  deps: SuggestionDeps,
  ctx: SuggestionContext,
  doc: WithId<AssistantTidyDoc>,
): Promise<WithId<AssistantTidyDoc>> {
  if (doc.applied) return doc;
  const chosen = new Set(doc.decision?.noteIds ?? []);
  const { moved, skipped } = await moveEach(
    operationContext(deps, ctx, doc.id),
    doc.moves
      .filter((move) => chosen.has(move.noteId))
      .map((move) => ({
        move,
        to: move.to,
        expectedRevision: move.baseRevision,
        operationId: move.operationIds.apply,
      })),
  );
  const ref = assistantTidiesCol(deps.db, ctx.actor.id).doc(doc.id);
  const now = deps.now?.() ?? new Date();
  return deps.db.runTransaction(async (tx) => {
    const current = withId(await tx.get(ref));
    if (!current) throw notFound();
    await assertAssistantBoardActive(deps.db, ctx.actor.id, current.boardId, tx);
    if (current.status !== 'KEPT' || current.applied) return current;
    const next: WithId<AssistantTidyDoc> = {
      ...current,
      applied: { moves: moved, skipped },
      updatedAt: Timestamp.fromDate(now),
    };
    tx.set(ref, stripId(next));
    return next;
  });
}

/**
 * Keep, discard or undo the batch (RFC-0005-wallybot-inline.md §3.5, plan R5, R7). A keep moves the
 * chosen notes through the command layer under the record's own operation ids; a note changed
 * since the proposal is skipped and the rest moves. An undo moves each applied note back on
 * the revision its move produced, under the undo ids, skipping a note changed since.
 */
export async function decideTidy(
  deps: SuggestionDeps,
  ctx: SuggestionContext,
  tidyId: string,
  decision: TidyDecision,
): Promise<TidyDto> {
  const { db } = deps;
  const { actor, board } = ctx;
  const now = deps.now?.() ?? new Date();

  if (decision.decision === 'discard') {
    const { doc } = await claimTidy(
      db,
      actor,
      board.id,
      tidyId,
      'PENDING',
      'DISCARDED',
      { source: decision.source, noteIds: [] },
      now,
    );
    return toTidyDto(doc);
  }

  if (decision.decision === 'keep') {
    const current = await loadTidy(db, actor, board.id, tidyId);
    if (current.status === 'KEPT') return toTidyDto(await completeKeep(deps, ctx, current));
    // Each proposed note once, in the record's order; a note the record never proposed is ignored.
    const requested = decision.noteIds ? new Set(decision.noteIds) : null;
    const noteIds = current.moves
      .map((m) => m.noteId)
      .filter((id) => !requested || requested.has(id));
    if (noteIds.length === 0) {
      const { doc } = await claimTidy(
        db,
        actor,
        board.id,
        tidyId,
        'PENDING',
        'DISCARDED',
        { source: decision.source, noteIds: [] },
        now,
      );
      return toTidyDto(doc);
    }
    const { doc } = await claimTidy(
      db,
      actor,
      board.id,
      tidyId,
      'PENDING',
      'KEPT',
      { source: decision.source, noteIds },
      now,
    );
    return toTidyDto(await completeKeep(deps, ctx, doc));
  }

  // undo
  let current = await loadTidy(db, actor, board.id, tidyId);
  if (current.status === 'UNDONE') return toTidyDto(current);
  if (current.status !== 'KEPT') throw settled();
  current = await completeKeep(deps, ctx, current);
  const { applied } = current;
  if (current.status !== 'KEPT' || !applied) throw settled();
  const byId = new Map(current.moves.map((m) => [m.noteId, m]));
  const { moved: movedBack } = await moveEach(
    operationContext(deps, ctx, current.id),
    [...applied.moves].reverse().flatMap(({ noteId, revision }) => {
      const move = byId.get(noteId);
      return move
        ? [{ move, to: move.from, expectedRevision: revision, operationId: move.operationIds.undo }]
        : [];
    }),
  );
  const { doc } = await claimTidy(
    db,
    actor,
    board.id,
    tidyId,
    'KEPT',
    'UNDONE',
    // The notes the undo moved back; a note changed since the keep stays, and is not named.
    { source: decision.source, noteIds: movedBack.map((m) => m.noteId) },
    now,
  );
  return toTidyDto(doc);
}
