import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type {
  CaptureSuggestRequest,
  EffectiveRole,
  Language,
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
import { estimateTokens } from './budget/estimate.js';
import { reserveAttempt, settleAttempt } from './budget/ledger.js';
import { priceFor } from './budget/prices.js';
import { buildCaptureInstructions, buildCapturePrompt } from './capturePrompt.js';
import type { ModelSuggestion, SuggestionRunner } from './model/index.js';
import { runOperation, type OperationContext } from './run.js';

export const SUGGESTION_MAX_OUTPUT_TOKENS = 256;
export const SUGGESTION_DEADLINE_MS = 20_000;
/** Below this the model's guess is dropped (the brief: low-confidence fields dropped). */
export const SUGGESTION_MIN_CONFIDENCE = 0.6;
/** As long as the receipts the keep and the undo rely on (WALLY_AGENT.md §3.2). */
export const SUGGESTION_RETENTION_DAYS = 7;

export interface SuggestionDeps {
  db: Firestore;
  env: Env;
  runner: SuggestionRunner;
  logger?: CommandLogger;
  now?: () => Date;
  deadlineMs?: number;
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

/** Keeps a field only when it is a candidate, confident enough, and (for a person) a member. */
function accept(
  fields: ModelSuggestion,
  open: SuggestionFieldKey[],
  memberIds: Set<string>,
): AssistantSuggestionDoc['fields'] {
  const sure = (c: number) => c >= SUGGESTION_MIN_CONFIDENCE;
  return {
    dueDate:
      open.includes('dueDate') && fields.dueDate && sure(fields.dueDate.confidence)
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

async function toDto(db: Firestore, doc: WithId<AssistantSuggestionDoc>): Promise<SuggestionDto> {
  const users = await loadUsers(db, [doc.fields.assignee?.value]);
  const assignee = doc.fields.assignee ? users.get(doc.fields.assignee.value) : undefined;
  const fields: SuggestionFields = {
    dueDate: doc.fields.dueDate,
    priority: doc.fields.priority,
    // A member who left since cannot be proposed any more; the field reads as empty.
    assignee:
      doc.fields.assignee && assignee
        ? {
            value: { id: assignee.id, email: assignee.email, displayName: assignee.displayName },
            reason: doc.fields.assignee.reason,
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
  deps: SuggestionDeps,
  ctx: SuggestionContext,
  request: CaptureSuggestRequest,
): Promise<SuggestionDto | null> {
  const clock = () => deps.now?.() ?? new Date();
  const { db, env } = deps;
  const { actor, board } = ctx;
  // Bound to the board: a note elsewhere is not found, exactly as a read operation would say.
  const note = await getNote(db, actor, request.noteId, board.id);
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
            inputTokens: estimateTokens([instructions, prompt]) + 16,
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
  const fields = accept(output.fields, open, new Set(memberRows.map((m) => m.id)));
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
  return toDto(db, { ...doc, id: ref.id });
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
  const ref = assistantSuggestionsCol(db, actor.id).doc(id);
  return db.runTransaction(async (tx) => {
    const current = withId(await tx.get(ref));
    if (!current || current.boardId !== boardId) throw notFound();
    if (current.status === to) return { doc: current, claimed: false };
    if (current.status !== from) throw settled();
    const next: WithId<AssistantSuggestionDoc> = {
      ...current,
      status: to,
      decision: { ...decision, at: Timestamp.fromDate(now) },
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

/** The three writes, in a fixed order, each on the revision the previous one returned. */
async function applyFields(
  deps: SuggestionDeps,
  ctx: SuggestionContext,
  doc: WithId<AssistantSuggestionDoc>,
  fields: SuggestionFieldKey[],
  values: { dueDate: string | null; priority: NotePriority; assigneeId: string | null },
  ids: (key: SuggestionFieldKey) => string,
  startRevision: number,
): Promise<number> {
  const opCtx = operationContext(deps, ctx, doc.id);
  const { boardId, noteId } = doc;
  let revision = startRevision;
  const run = async (name: string, input: unknown, operationId: string) => {
    const result = await runOperation(opCtx, { name, input, operationId });
    revision = result.revision ?? revision;
  };
  if (fields.includes('dueDate'))
    await run(
      'update_note',
      { boardId, noteId, expectedRevision: revision, input: { dueDate: values.dueDate } },
      ids('dueDate'),
    );
  if (fields.includes('priority'))
    await run(
      'move_note',
      {
        boardId,
        noteId,
        expectedRevision: revision,
        input: { mode: 'PRIORITY', priority: values.priority },
      },
      ids('priority'),
    );
  if (fields.includes('assignee'))
    await run(
      'assign_note',
      { boardId, noteId, expectedRevision: revision, input: { assigneeId: values.assigneeId } },
      ids('assignee'),
    );
  return revision;
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
  const ref = assistantSuggestionsCol(db, actor.id).doc(suggestionId);
  const stamp = () => Timestamp.fromDate(deps.now?.() ?? new Date());

  if (decision.decision === 'discard') {
    const { doc } = await claim(
      db,
      actor,
      board.id,
      suggestionId,
      'PENDING',
      'DISCARDED',
      {
        source: decision.source,
        fields: [],
      },
      now,
    );
    return toDto(db, doc);
  }

  if (decision.decision === 'keep') {
    const current = await loadSuggestion(db, actor, board.id, suggestionId);
    const proposed = proposedKeys(current.fields);
    const fields = (decision.fields ?? proposed).filter((key) => proposed.includes(key));
    if (fields.length === 0) {
      const { doc } = await claim(
        db,
        actor,
        board.id,
        suggestionId,
        'PENDING',
        'DISCARDED',
        {
          source: decision.source,
          fields: [],
        },
        now,
      );
      return toDto(db, doc);
    }
    const { doc, claimed } = await claim(
      db,
      actor,
      board.id,
      suggestionId,
      'PENDING',
      'KEPT',
      {
        source: decision.source,
        fields,
      },
      now,
    );
    // The other tab's keep is running or done; its outcome is the record's. Replaying the
    // writes here would be safe (same operation ids) but would race its `applied` write.
    if (!claimed) return toDto(db, doc);
    const kept = doc.decision?.fields ?? fields;
    const note = await getNote(db, actor, doc.noteId, board.id);
    if (note.revision !== doc.baseRevision) {
      await ref.update({ status: 'DISCARDED', updatedAt: stamp() });
      throw new AppError(
        409,
        'STALE_REVISION',
        'The resource changed; review the latest version before saving',
      );
    }
    const before = {
      dueDate: note.dueDate,
      priority: note.priority,
      assigneeId: note.assignee?.id ?? null,
    };
    const values = {
      dueDate: doc.fields.dueDate?.value ?? null,
      priority: doc.fields.priority?.value ?? note.priority,
      assigneeId: doc.fields.assignee?.value ?? null,
    };
    const revision = await applyFields(
      deps,
      ctx,
      doc,
      kept,
      values,
      (key) => doc.operationIds[key].apply,
      note.revision,
    );
    const applied = { before, fields: kept, revision };
    await ref.update({ applied, updatedAt: stamp() });
    return toDto(db, { ...doc, applied });
  }

  // undo
  const current = await loadSuggestion(db, actor, board.id, suggestionId);
  if (current.status === 'UNDONE') return toDto(db, current);
  if (current.status !== 'KEPT' || !current.applied) throw settled();
  const inverse = [...current.applied.fields].reverse();
  // Inverse order, so each revision check sees exactly the state the keep left behind.
  let revision = current.applied.revision;
  const opCtx = operationContext(deps, ctx, current.id);
  const { boardId, noteId } = current;
  const { before } = current.applied;
  for (const key of inverse) {
    const operationId = current.operationIds[key].undo;
    const result =
      key === 'assignee'
        ? await runOperation(opCtx, {
            name: 'assign_note',
            input: {
              boardId,
              noteId,
              expectedRevision: revision,
              input: { assigneeId: before.assigneeId },
            },
            operationId,
          })
        : key === 'priority'
          ? await runOperation(opCtx, {
              name: 'move_note',
              input: {
                boardId,
                noteId,
                expectedRevision: revision,
                input: { mode: 'PRIORITY', priority: before.priority },
              },
              operationId,
            })
          : await runOperation(opCtx, {
              name: 'update_note',
              input: {
                boardId,
                noteId,
                expectedRevision: revision,
                input: { dueDate: before.dueDate },
              },
              operationId,
            });
    revision = result.revision ?? revision;
  }
  const { doc } = await claim(
    db,
    actor,
    board.id,
    suggestionId,
    'KEPT',
    'UNDONE',
    {
      source: decision.source,
      fields: inverse,
    },
    now,
  );
  return toDto(db, doc);
}

/** The caller's pending records on a board, oldest first, for a board that was just opened (plan R5). */
export async function pendingSuggestions(
  db: Firestore,
  actor: Actor,
  boardId: string,
): Promise<SuggestionDto[]> {
  // Two equality filters need no composite index; the sort is done here.
  const docs = docsWithId(
    await assistantSuggestionsCol(db, actor.id)
      .where('boardId', '==', boardId)
      .where('status', '==', 'PENDING')
      .get(),
  );
  docs.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  return Promise.all(docs.map((doc) => toDto(db, doc)));
}
