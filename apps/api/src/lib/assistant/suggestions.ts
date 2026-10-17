import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type {
  CaptureSuggestRequest,
  EffectiveRole,
  Language,
  NoteDetailDto,
  NotePriority,
  SuggestionDecision,
  SuggestionDto,
  SuggestionFieldKey,
  SuggestionFields,
} from '@wally/shared';
import { suggestionFieldKeys } from '@wally/shared';
import type { Env } from '../../env.js';
import type { Actor, CommandLogger } from '../commands/index.js';
import { getNote, listMembers } from '../commands/queries.js';
import {
  assistantSuggestionsCol,
  docsWithId,
  loadUsers,
  notesCol,
  stripId,
  toIso,
  withId,
} from '../db/collections.js';
import type {
  AssistantSuggestionDoc,
  SuggestionOperationIds,
  WhiteboardDoc,
  WithId,
} from '../db/types.js';
import { AppError } from '../errors.js';
import { isValidAssignee } from '../notes.js';
import { estimateTokens } from './budget/estimate.js';
import { reserveAttempt, settleAttempt } from './budget/ledger.js';
import { priceFor } from './budget/prices.js';
import { buildCaptureInstructions, buildCapturePrompt } from './capturePrompt.js';
import {
  suggestionSchemaJson,
  type ModelSuggestion,
  type SuggestionRunner,
} from './model/index.js';
import { runOperation, type OperationContext } from './run.js';

export const SUGGESTION_MAX_OUTPUT_TOKENS = 256;
export const SUGGESTION_DEADLINE_MS = 20_000;
/** Below this the model's guess is dropped (the brief: low-confidence fields dropped). */
export const SUGGESTION_MIN_CONFIDENCE = 0.6;
/** As long as the receipts the keep and the undo rely on (WALLY_AGENT.md §3.2). */
export const SUGGESTION_RETENTION_DAYS = 7;
/**
 * A pending record older than this is not shown again (the ruling amending plan R5): the
 * proposal was for a note just written, and a day later it is no longer that.
 */
export const SUGGESTION_PENDING_MAX_AGE_MS = 24 * 3_600_000;

/** What a decision and the pending list need; neither calls the model. */
export interface SuggestionDeps {
  db: Firestore;
  env: Env;
  logger?: CommandLogger;
  now?: () => Date;
  deadlineMs?: number;
}
/** A capture also calls the model. */
export interface CaptureDeps extends SuggestionDeps {
  runner: SuggestionRunner;
}
export interface SuggestionContext {
  actor: Actor;
  language: Language;
  board: WithId<WhiteboardDoc>;
  role: EffectiveRole;
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Not found');
const settled = () =>
  new AppError(409, 'ASSISTANT_SUGGESTION_SETTLED', 'This suggestion was already decided');

function mintOperationIds(): SuggestionOperationIds {
  return {
    dueDate: { apply: randomUUID(), undo: randomUUID() },
    priority: { apply: randomUUID(), undo: randomUUID() },
    assignee: { apply: randomUUID(), undo: randomUUID() },
  };
}

/** Which of the three fields may be proposed for this note (plan R3). */
function candidates(
  note: { dueDate: string | null; priority: NotePriority; assignee: unknown; visibility: string },
  locked: SuggestionFieldKey[],
): SuggestionFieldKey[] {
  const open: SuggestionFieldKey[] = [];
  if (note.dueDate === null && !locked.includes('dueDate')) open.push('dueDate');
  if (note.priority === 'MITTEL' && !locked.includes('priority')) open.push('priority');
  if (note.assignee === null && note.visibility !== 'PRIVATE' && !locked.includes('assignee'))
    open.push('assignee');
  return open;
}

/**
 * Keeps a field only when it is a candidate, confident enough, and (for a person) a member. A
 * due date before the person's today is dropped: nobody writes a task that was due last week.
 * Both are YYYY-MM-DD, so the string order is the calendar order.
 */
function accept(
  fields: ModelSuggestion,
  open: SuggestionFieldKey[],
  memberIds: Set<string>,
  today: string,
): AssistantSuggestionDoc['fields'] {
  const sure = (c: number) => c >= SUGGESTION_MIN_CONFIDENCE;
  return {
    dueDate:
      open.includes('dueDate') &&
      fields.dueDate &&
      sure(fields.dueDate.confidence) &&
      fields.dueDate.value >= today
        ? { value: fields.dueDate.value, reason: fields.dueDate.reason }
        : null,
    priority:
      open.includes('priority') && fields.priority && sure(fields.priority.confidence)
        ? { value: fields.priority.value, reason: fields.priority.reason }
        : null,
    assignee:
      open.includes('assignee') &&
      fields.assignee &&
      sure(fields.assignee.confidence) &&
      memberIds.has(fields.assignee.memberId)
        ? { value: fields.assignee.memberId, reason: fields.assignee.reason }
        : null,
  };
}

const proposedKeys = (fields: AssistantSuggestionDoc['fields']): SuggestionFieldKey[] =>
  suggestionFieldKeys.filter((key) => fields[key] !== null);

/**
 * The proposal as it can still be kept today: an assignee who is no longer the owner or an
 * active member of the board drops out (the same rule as `assertValidAssignee`), both from
 * what the card shows and from what a keep writes.
 */
function liveFields(
  board: WithId<WhiteboardDoc>,
  fields: AssistantSuggestionDoc['fields'],
): AssistantSuggestionDoc['fields'] {
  return fields.assignee && !isValidAssignee(board, fields.assignee.value)
    ? { ...fields, assignee: null }
    : fields;
}

async function toDto(
  db: Firestore,
  board: WithId<WhiteboardDoc>,
  doc: WithId<AssistantSuggestionDoc>,
): Promise<SuggestionDto> {
  const live = liveFields(board, doc.fields);
  const users = await loadUsers(db, [live.assignee?.value]);
  const assignee = live.assignee ? users.get(live.assignee.value) : undefined;
  const fields: SuggestionFields = {
    dueDate: live.dueDate,
    priority: live.priority,
    // A member who left since cannot be proposed any more; the field reads as empty.
    assignee:
      live.assignee && assignee
        ? {
            value: { id: assignee.id, email: assignee.email, displayName: assignee.displayName },
            reason: live.assignee.reason,
          }
        : null,
  };
  return {
    id: doc.id,
    boardId: doc.boardId,
    noteId: doc.noteId,
    status: doc.status,
    baseRevision: doc.baseRevision,
    fields,
    kept: doc.applied ? { fields: doc.applied.fields, revision: doc.applied.revision } : null,
    createdAt: toIso(doc.createdAt),
  };
}

/**
 * One capture turn (WALLYBOT_INLINE.md §3.3, §4): read the note, decide what may be proposed,
 * reserve, call, settle, filter, and store the record only when something survived. Throws
 * BudgetError and AppError only; the provider's own error becomes 502 without its wording.
 */
export async function suggestForCapture(
  deps: CaptureDeps,
  ctx: SuggestionContext,
  request: CaptureSuggestRequest,
): Promise<SuggestionDto | null> {
  const clock = () => deps.now?.() ?? new Date();
  const { db, env } = deps;
  const { actor, board } = ctx;
  // Bound to the board: a note elsewhere is not found, exactly as a read operation would say.
  const note = await getNote(db, actor, request.noteId, board.id);
  // Enrichment of a note the person just wrote (the slice), so only their own: on anyone
  // else's a keep could be refused after the call was paid for, and the answer is the same
  // 404 a note they cannot see gets.
  if (note.createdBy?.id !== actor.id) throw notFound();
  if (!note.title.trim() && !note.description.trim()) return null;
  const open = candidates(note, request.locked);
  if (open.length === 0) return null;

  const members = (await listMembers(db, actor, board.id)).data;
  const memberRows = members.flatMap((m) =>
    m.userId ? [{ id: m.userId, name: m.displayName ?? m.email }] : [],
  );
  const instructions = buildCaptureInstructions({
    today: request.today,
    timeZone: request.timeZone,
    language: ctx.language,
  });
  const prompt = buildCapturePrompt({
    title: note.title,
    description: note.description,
    members: memberRows,
  });
  // The response schema travels with the call, so the estimate counts its real size.
  const schema = await suggestionSchemaJson();
  const model = env.ASSISTANT_MODEL;
  const price = priceFor(model);
  const caps = {
    dailyTokens: env.ASSISTANT_DAILY_CAP_TOKENS,
    monthlyMicroUsd: env.ASSISTANT_MONTHLY_CAP_MICRO_USD,
  };
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), deps.deadlineMs ?? SUGGESTION_DEADLINE_MS);
  const startedAt = Date.now();
  let output;
  try {
    output = await deps.runner({
      instructions,
      prompt,
      maxOutputTokens: SUGGESTION_MAX_OUTPUT_TOKENS,
      abortSignal: controller.signal,
      onAttempt: async (info) => {
        const reservation = await reserveAttempt(db, {
          userId: actor.id,
          now: clock(),
          estimate: {
            inputTokens: estimateTokens([instructions, prompt, schema]) + 16,
            // The runner's allowance, thinking room included: everything the call may bill.
            outputTokens: info.maxOutputTokens,
          },
          price,
          caps,
        });
        return {
          settle: (usage) =>
            settleAttempt(
              db,
              actor.id,
              reservation.attemptId,
              { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
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
    type: 'assistant.capture',
    boardId: board.id,
    noteId: note.id,
    proposed: output.fields !== null,
    usage: output.usage,
    ms: Date.now() - startedAt,
  });
  if (!output.fields) return null;
  const fields = accept(output.fields, open, new Set(memberRows.map((m) => m.id)), request.today);
  if (proposedKeys(fields).length === 0) return null;

  const now = clock();
  const stamp = Timestamp.fromDate(now);
  const doc: AssistantSuggestionDoc = {
    boardId: board.id,
    noteId: note.id,
    baseRevision: note.revision,
    fields,
    operationIds: mintOperationIds(),
    status: 'PENDING',
    decision: null,
    undone: null,
    applied: null,
    model,
    usage: {
      inputTokens: output.usage?.inputTokens ?? 0,
      outputTokens: output.usage?.outputTokens ?? 0,
    },
    createdAt: stamp,
    updatedAt: stamp,
    expiresAt: Timestamp.fromMillis(now.getTime() + SUGGESTION_RETENTION_DAYS * 86_400_000),
  };
  const ref = assistantSuggestionsCol(db, actor.id).doc();
  await ref.create(doc);
  return toDto(db, board, { ...doc, id: ref.id });
}

/** The caller's own record on this board, or 404 (the access recheck of WALLY_AGENT.md §3.4). */
async function loadSuggestion(
  db: Firestore,
  actor: Actor,
  boardId: string,
  id: string,
): Promise<WithId<AssistantSuggestionDoc>> {
  const doc = withId(await assistantSuggestionsCol(db, actor.id).doc(id).get());
  if (!doc || doc.boardId !== boardId) throw notFound();
  return doc;
}

/**
 * Claims the record for one decision in a transaction, so two tabs deciding at once agree on
 * one outcome: the first flips the status, the second sees it flipped and replays. Returns
 * the record as it stands after the claim and whether this call made it.
 */
async function claim(
  db: Firestore,
  actor: Actor,
  boardId: string,
  id: string,
  from: AssistantSuggestionDoc['status'],
  to: AssistantSuggestionDoc['status'],
  decision: { source: string; fields: SuggestionFieldKey[] },
  now: Date,
): Promise<{ doc: WithId<AssistantSuggestionDoc>; claimed: boolean }> {
  // An undo is recorded beside the keep, so the keep's own decision (its source and fields)
  // stays on the record after the undo.
  const field = to === 'UNDONE' ? 'undone' : 'decision';
  const ref = assistantSuggestionsCol(db, actor.id).doc(id);
  return db.runTransaction(async (tx) => {
    const current = withId(await tx.get(ref));
    if (!current || current.boardId !== boardId) throw notFound();
    if (current.status === to) return { doc: current, claimed: false };
    if (current.status !== from) throw settled();
    const next: WithId<AssistantSuggestionDoc> = {
      ...current,
      status: to,
      ...(field === 'undone'
        ? { undone: { source: decision.source, at: Timestamp.fromDate(now) } }
        : { decision: { ...decision, at: Timestamp.fromDate(now) } }),
      updatedAt: Timestamp.fromDate(now),
    };
    tx.set(ref, stripId(next));
    return { doc: next, claimed: true };
  });
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
    assistantEnabled: true,
    // The suggestion is the approval record; a capture turn has no conversation (plan R2).
    provenance: { via: 'assistant', conversationId: id, approvalId: id },
    logger: deps.logger,
  };
}

type FieldValues = { dueDate: string | null; priority: NotePriority; assigneeId: string | null };

/**
 * What a proposed field held at `baseRevision`. A field is proposed only when the note has
 * nothing there (plan R3), so these are exact for every field a keep may write.
 */
const EMPTY: FieldValues = { dueDate: null, priority: 'MITTEL', assigneeId: null };

/** What a keep writes: the proposed values (a field that is not kept is never read). */
function proposedValues(doc: AssistantSuggestionDoc): FieldValues {
  return {
    dueDate: doc.fields.dueDate?.value ?? EMPTY.dueDate,
    priority: doc.fields.priority?.value ?? EMPTY.priority,
    assigneeId: doc.fields.assignee?.value ?? EMPTY.assigneeId,
  };
}

const valueOf = (key: SuggestionFieldKey, values: FieldValues) =>
  key === 'dueDate' ? values.dueDate : key === 'priority' ? values.priority : values.assigneeId;
const noteValue = (key: SuggestionFieldKey, note: NoteDetailDto) =>
  key === 'dueDate'
    ? note.dueDate
    : key === 'priority'
      ? note.priority
      : (note.assignee?.id ?? null);

/** The one operation that sets one field, with exactly the keys the strict schemas accept. */
function fieldCall(
  key: SuggestionFieldKey,
  doc: Pick<AssistantSuggestionDoc, 'boardId' | 'noteId'>,
  expectedRevision: number,
  values: FieldValues,
): { name: string; input: unknown } {
  const { boardId, noteId } = doc;
  if (key === 'dueDate')
    return {
      name: 'update_note',
      input: { boardId, noteId, expectedRevision, input: { dueDate: values.dueDate } },
    };
  if (key === 'priority')
    return {
      name: 'move_note',
      input: {
        boardId,
        noteId,
        expectedRevision,
        input: { mode: 'PRIORITY', priority: values.priority },
      },
    };
  return {
    name: 'assign_note',
    input: { boardId, noteId, expectedRevision, input: { assigneeId: values.assigneeId } },
  };
}

/**
 * Writes the fields in the given order, each on the revision the previous one returned,
 * starting from `startRevision`. The chain is deterministic: run again from the same start
 * under the same ids, every write that already committed replays its receipt (same input,
 * same expected revision) and the chain picks up at the first one that did not. `done`
 * collects the fields whose write committed or replayed, so a caller can see how far it got
 * when a later write throws.
 */
async function runChain(
  opCtx: OperationContext,
  doc: WithId<AssistantSuggestionDoc>,
  keys: SuggestionFieldKey[],
  values: FieldValues,
  ids: (key: SuggestionFieldKey) => string,
  startRevision: number,
  done: SuggestionFieldKey[],
): Promise<number> {
  let revision = startRevision;
  for (const key of keys) {
    const { name, input } = fieldCall(key, doc, revision, values);
    const result = await runOperation(opCtx, { name, input, operationId: ids(key) });
    revision = result.revision ?? revision;
    done.push(key);
  }
  return revision;
}

/** A refusal that a retry under the same ids cannot change (stale, gone, forbidden, invalid). */
const isFinal = (error: unknown): error is AppError =>
  error instanceof AppError && error.statusCode < 500;

/**
 * Best effort, after a chain failed for good: puts back each field the chain wrote, newest
 * first, while the note still holds what the chain wrote there. A field someone changed
 * since is theirs and stays. These are new writes on the note's current revision, so they
 * take fresh operation ids; a failure here is logged and the next field is still tried.
 */
async function revertWrites(
  deps: SuggestionDeps,
  ctx: SuggestionContext,
  doc: WithId<AssistantSuggestionDoc>,
  done: SuggestionFieldKey[],
  written: FieldValues,
  restore: FieldValues,
): Promise<void> {
  const opCtx = operationContext(deps, ctx, doc.id);
  for (const key of [...done].reverse()) {
    try {
      const note = await getNote(deps.db, ctx.actor, doc.noteId, ctx.board.id);
      if (noteValue(key, note) !== valueOf(key, written)) continue;
      const { name, input } = fieldCall(key, doc, note.revision, restore);
      await runOperation(opCtx, { name, input, operationId: randomUUID() });
    } catch (error) {
      deps.logger?.warn({
        type: 'assistant.suggestion_revert_failed',
        suggestionId: doc.id,
        field: key,
        outcome: error instanceof AppError ? error.code : 'failed',
      });
    }
  }
}

/**
 * Moves a record that is still KEPT with nothing applied, inside a transaction, so a tab
 * that finished first is never overwritten. Returns the record as it stands afterwards.
 */
async function settleKeep(
  db: Firestore,
  actor: Actor,
  id: string,
  change: Pick<AssistantSuggestionDoc, 'status'> & Partial<Pick<AssistantSuggestionDoc, 'applied'>>,
  now: Date,
): Promise<WithId<AssistantSuggestionDoc>> {
  const ref = assistantSuggestionsCol(db, actor.id).doc(id);
  return db.runTransaction(async (tx) => {
    const current = withId(await tx.get(ref));
    if (!current) throw notFound();
    if (current.status !== 'KEPT' || current.applied) return current;
    const next: WithId<AssistantSuggestionDoc> = {
      ...current,
      ...change,
      updatedAt: Timestamp.fromDate(now),
    };
    tx.set(ref, stripId(next));
    return next;
  });
}

/**
 * Runs, resumes or replays the writes of a claimed keep. Every keep of a KEPT record with
 * nothing applied comes here: the tab that claimed it, a second tab that lost the claim, and
 * a repeat after a keep that was cut short (a crash, a timeout, a contended transaction).
 * They all run the same chain from `baseRevision` under the record's own apply ids, so the
 * note changes once and each field leaves one audit record.
 *
 * A refusal that cannot change on a retry (the note changed underneath, the note is gone,
 * the assignee left, the caller lost access) ends the keep: the fields this keep did write
 * are put back where nobody changed them since, the record becomes DISCARDED, and the
 * refusal is the answer. Anything else leaves the record KEPT with nothing applied, so the
 * next keep or undo resumes it.
 */
async function completeKeep(
  deps: SuggestionDeps,
  ctx: SuggestionContext,
  doc: WithId<AssistantSuggestionDoc>,
): Promise<WithId<AssistantSuggestionDoc>> {
  if (doc.applied) return doc;
  const { db } = deps;
  const kept = doc.decision?.fields ?? [];
  const written = proposedValues(doc);
  const done: SuggestionFieldKey[] = [];
  let note: NoteDetailDto;
  let revision: number;
  try {
    note = await getNote(db, ctx.actor, doc.noteId, ctx.board.id);
    // The first write carries `baseRevision`, so a note changed since the proposal refuses
    // it with 409 STALE_REVISION before anything is written.
    revision = await runChain(
      operationContext(deps, ctx, doc.id),
      doc,
      kept,
      written,
      (key) => doc.operationIds[key].apply,
      doc.baseRevision,
      done,
    );
  } catch (error) {
    if (!isFinal(error)) throw error;
    await revertWrites(deps, ctx, doc, done, written, EMPTY);
    await settleKeep(db, ctx.actor, doc.id, { status: 'DISCARDED' }, deps.now?.() ?? new Date());
    throw error;
  }
  // Kept fields held nothing at the base (R3); the others are as the keep found them.
  const before: FieldValues = {
    dueDate: kept.includes('dueDate') ? EMPTY.dueDate : note.dueDate,
    priority: kept.includes('priority') ? EMPTY.priority : note.priority,
    assigneeId: kept.includes('assignee') ? EMPTY.assigneeId : (note.assignee?.id ?? null),
  };
  return settleKeep(
    db,
    ctx.actor,
    doc.id,
    { status: 'KEPT', applied: { before, fields: kept, revision } },
    deps.now?.() ?? new Date(),
  );
}

/**
 * Keep, discard or undo (WALLYBOT_INLINE.md §4). A keep applies the kept fields through the
 * command layer under the record's own operation ids, so a repeat replays receipts and the
 * note changes once; it is refused with 409 STALE_REVISION, and the record discarded, when
 * the note changed since the proposal. An undo is the inverse on the kept revision.
 */
export async function decideSuggestion(
  deps: SuggestionDeps,
  ctx: SuggestionContext,
  suggestionId: string,
  decision: SuggestionDecision,
): Promise<SuggestionDto> {
  const { db } = deps;
  const { actor, board } = ctx;
  const now = deps.now?.() ?? new Date();

  if (decision.decision === 'discard') {
    const { doc } = await claim(
      db,
      actor,
      board.id,
      suggestionId,
      'PENDING',
      'DISCARDED',
      { source: decision.source, fields: [] },
      now,
    );
    return toDto(db, board, doc);
  }

  if (decision.decision === 'keep') {
    const current = await loadSuggestion(db, actor, board.id, suggestionId);
    if (current.status === 'KEPT') return toDto(db, board, await completeKeep(deps, ctx, current));
    // What can still be kept: an assignee who left the board since drops out here.
    const proposed = proposedKeys(liveFields(board, current.fields));
    // Each field once, in the one order the chain and its receipts use: a field named twice
    // would run its write twice under one operation id and be refused.
    const requested = decision.fields ?? proposed;
    const fields = suggestionFieldKeys.filter(
      (key) => requested.includes(key) && proposed.includes(key),
    );
    if (fields.length === 0) {
      const { doc } = await claim(
        db,
        actor,
        board.id,
        suggestionId,
        'PENDING',
        'DISCARDED',
        { source: decision.source, fields: [] },
        now,
      );
      return toDto(db, board, doc);
    }
    // Whoever wins the claim, every keep then runs the same chain: the loser's writes replay
    // the winner's receipts, and both answer with the record's one outcome.
    const { doc } = await claim(
      db,
      actor,
      board.id,
      suggestionId,
      'PENDING',
      'KEPT',
      { source: decision.source, fields },
      now,
    );
    return toDto(db, board, await completeKeep(deps, ctx, doc));
  }

  // undo
  let current = await loadSuggestion(db, actor, board.id, suggestionId);
  if (current.status === 'UNDONE') return toDto(db, board, current);
  if (current.status !== 'KEPT') throw settled();
  // A keep still running or cut short finishes first, so the undo has its receipts to invert.
  current = await completeKeep(deps, ctx, current);
  if (current.status === 'UNDONE') return toDto(db, board, current);
  const { applied } = current;
  if (current.status !== 'KEPT' || !applied) throw settled();
  // Inverse order, so each revision check sees exactly the state the keep left behind. Run
  // again after a cut-short undo, the inverse writes that committed replay their receipts.
  const inverse = [...applied.fields].reverse();
  const undoIds = current.operationIds;
  const done: SuggestionFieldKey[] = [];
  try {
    await runChain(
      operationContext(deps, ctx, current.id),
      current,
      inverse,
      applied.before,
      (key) => undoIds[key].undo,
      applied.revision,
      done,
    );
  } catch (error) {
    // Refused for good part way (someone edited the note between two inverse writes): the
    // fields already put back return to what the keep wrote, so the record stays KEPT and
    // the note is not left half undone.
    if (isFinal(error))
      await revertWrites(deps, ctx, current, done, applied.before, proposedValues(current));
    throw error;
  }
  const { doc } = await claim(
    db,
    actor,
    board.id,
    suggestionId,
    'KEPT',
    'UNDONE',
    { source: decision.source, fields: inverse },
    now,
  );
  return toDto(db, board, doc);
}

/**
 * The caller's pending records on a board, oldest first, for a board that was just opened
 * (plan R5 as amended). A record that can no longer be what it was is left out and discarded
 * in one batch, so it is never shown again: its note is gone, the note changed since the
 * proposal (a keep would be refused), or it is more than a day old.
 */
export async function pendingSuggestions(
  db: Firestore,
  actor: Actor,
  board: WithId<WhiteboardDoc>,
  now: Date = new Date(),
): Promise<SuggestionDto[]> {
  // Two equality filters need no composite index; the sort is done here.
  const docs = docsWithId(
    await assistantSuggestionsCol(db, actor.id)
      .where('boardId', '==', board.id)
      .where('status', '==', 'PENDING')
      .get(),
  );
  if (docs.length === 0) return [];
  const notes = await db.getAll(...docs.map((doc) => notesCol(db).doc(doc.noteId)));
  const byId = new Map(notes.map((snap) => [snap.id, snap.data()]));
  const live: WithId<AssistantSuggestionDoc>[] = [];
  const stale: WithId<AssistantSuggestionDoc>[] = [];
  for (const doc of docs) {
    const note = byId.get(doc.noteId);
    const usable =
      note !== undefined &&
      !note.deletedAt &&
      note.whiteboardId === board.id &&
      (note.revision ?? 0) === doc.baseRevision &&
      now.getTime() - doc.createdAt.toMillis() <= SUGGESTION_PENDING_MAX_AGE_MS;
    (usable ? live : stale).push(doc);
  }
  if (stale.length > 0) {
    const batch = db.batch();
    const stamp = Timestamp.fromDate(now);
    const col = assistantSuggestionsCol(db, actor.id);
    // Only the status moves: no decision was taken, so none is recorded. A record decided in
    // another tab between the read and this write is a lost race the next keep refuses anyway.
    for (const doc of stale)
      batch.update(col.doc(doc.id), { status: 'DISCARDED', updatedAt: stamp });
    await batch.commit();
  }
  live.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  return Promise.all(live.map((doc) => toDto(db, board, doc)));
}
