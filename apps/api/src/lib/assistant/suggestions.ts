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
import {
  SUGGESTION_MAX_SUBTASKS,
  customFieldKeySchema,
  customFieldValueSchema,
  findFieldKey,
  foldFieldKey,
  suggestionFieldKeys,
} from '@wally/shared';
import type { Env } from '../../env.js';
import type { Actor, CommandLogger } from '../commands/index.js';
import { getNote, listMembers, listNotes } from '../commands/queries.js';
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
  NoteDoc,
  SuggestionOperationIds,
  WhiteboardDoc,
  WithId,
} from '../db/types.js';
import { AppError } from '../errors.js';
import { canSeeNote, isValidAssignee } from '../notes.js';
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

export const SUGGESTION_MAX_OUTPUT_TOKENS = 512;
export const SUGGESTION_DEADLINE_MS = 20_000;
/** Below this the model's guess is dropped (the brief: low-confidence fields dropped). */
export const SUGGESTION_MIN_CONFIDENCE = 0.6;
/** Fewer steps than this are no breakdown: steps are proposed two to five (plan R7). */
export const SUGGESTION_MIN_SUBTASKS = 2;
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
    title: { apply: randomUUID(), undo: randomUUID() },
    reference: { apply: randomUUID(), undo: randomUUID() },
    subtasks: Array.from({ length: SUGGESTION_MAX_SUBTASKS }, () => ({
      apply: randomUUID(),
      undo: randomUUID(),
    })),
    links: { apply: randomUUID(), undo: randomUUID() },
  };
}

/**
 * Which fields may be proposed for this note: an empty one the person did not decide while
 * writing (plan R3), a cleaner title beside a title they wrote, and a reference or steps only
 * on a note that has no property and no step yet (R7).
 */
function candidates(
  note: Pick<
    NoteDetailDto,
    'dueDate' | 'priority' | 'assignee' | 'visibility' | 'title' | 'customFields' | 'subtaskSummary'
  >,
  locked: SuggestionFieldKey[],
): SuggestionFieldKey[] {
  const open: SuggestionFieldKey[] = [];
  if (note.dueDate === null && !locked.includes('dueDate')) open.push('dueDate');
  if (note.priority === 'MITTEL' && !locked.includes('priority')) open.push('priority');
  if (note.assignee === null && note.visibility !== 'PRIVATE' && !locked.includes('assignee'))
    open.push('assignee');
  if (note.title.trim() && !locked.includes('title')) open.push('title');
  if (Object.keys(note.customFields ?? {}).length === 0 && !locked.includes('reference'))
    open.push('reference');
  if (note.subtaskSummary.total === 0 && !locked.includes('subtasks')) open.push('subtasks');
  return open;
}

/**
 * The property keys the board's notes use, for the prompt: one spelling per key compared
 * through the shared, locale-neutral fold (the first one seen), sorted for the caller's
 * language. Mirrors the web's `collectFieldKeys`, so the model sees the keys the panel offers.
 */
export function collectKeys(
  notes: { customFields: Record<string, string> }[],
  language: Language,
): string[] {
  const byFolded = new Map<string, string>();
  for (const note of notes)
    for (const key of Object.keys(note.customFields ?? {})) {
      const folded = foldFieldKey(key);
      if (!byFolded.has(folded)) byFolded.set(folded, key);
    }
  return [...byFolded.values()].sort((a, b) => a.localeCompare(b, language));
}

/** The fields a chip sets while writing: what the review's first group lists besides the words. */
const TYPED_KEYS: readonly SuggestionFieldKey[] = ['dueDate', 'priority', 'assignee'];

/** Each value once, first occurrence first. */
const unique = <T>(values: T[]): T[] => [...new Set(values)];

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
  note: { title: string },
  fieldKeys: string[],
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
    // A "cleaner" title that is the person's own is nothing to offer.
    title:
      open.includes('title') &&
      fields.title &&
      sure(fields.title.confidence) &&
      fields.title.value.trim() !== note.title.trim()
        ? { value: fields.title.value.trim(), reason: fields.title.reason }
        : null,
    reference:
      open.includes('reference') && fields.reference && sure(fields.reference.confidence)
        ? acceptReference(fields.reference, fieldKeys)
        : null,
    subtasks:
      open.includes('subtasks') && fields.subtasks && sure(fields.subtasks.confidence)
        ? acceptSubtasks(fields.subtasks)
        : null,
    links: null,
  };
}

/**
 * The key folds to the board's own spelling when the board already uses it ("customer" becomes
 * "Customer"), so a keep never starts a near-duplicate property. A key or value the property
 * schema refuses drops the reference.
 */
function acceptReference(
  reference: NonNullable<ModelSuggestion['reference']>,
  fieldKeys: string[],
): NonNullable<AssistantSuggestionDoc['fields']['reference']> | null {
  const wanted = foldFieldKey(reference.key);
  const key = fieldKeys.find((k) => foldFieldKey(k) === wanted) ?? reference.key.trim();
  const parsedKey = customFieldKeySchema.safeParse(key);
  const parsedValue = customFieldValueSchema.safeParse(reference.value);
  if (!parsedKey.success || !parsedValue.success) return null;
  return { key: parsedKey.data, value: parsedValue.data, reason: reference.reason };
}

/**
 * The runner already trimmed the steps, dropped the blank and repeated ones and cut them to
 * `SUGGESTION_MAX_SUBTASKS` (`modelSuggestionSchema`); one step left is no breakdown.
 */
function acceptSubtasks(
  subtasks: NonNullable<ModelSuggestion['subtasks']>,
): NonNullable<AssistantSuggestionDoc['fields']['subtasks']> | null {
  const { items } = subtasks;
  return items.length >= SUGGESTION_MIN_SUBTASKS ? { items, reason: subtasks.reason } : null;
}

const proposedKeys = (fields: AssistantSuggestionDoc['fields']): SuggestionFieldKey[] =>
  // A slice 2 record has no title, reference or subtasks at all: absent reads as nothing proposed.
  suggestionFieldKeys.filter((key) => (fields[key] ?? null) !== null);

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
  ownerId: string,
  doc: WithId<AssistantSuggestionDoc>,
): Promise<SuggestionDto> {
  const live = liveFields(board, doc.fields);
  const users = await loadUsers(db, [live.assignee?.value]);
  const assignee = live.assignee ? users.get(live.assignee.value) : undefined;
  // A proposed link reads with its target's current title. A target the record's owner cannot
  // see (gone, on another board, or made private by someone else since) drops out (L2, L3, L7).
  // Each item keeps the index it has in the stored record, so a keep and its echo (`kept.links`)
  // name the same items however many dropped out.
  const linkIds = live.links?.items.map((item) => item.noteId) ?? [];
  const targets = linkIds.length
    ? await db.getAll(...linkIds.map((id) => notesCol(db).doc(id)))
    : [];
  const titles = new Map(
    targets.flatMap((snap) => {
      const data = snap.data() as NoteDoc | undefined;
      return data && !data.deletedAt && data.whiteboardId === board.id && canSeeNote(data, ownerId)
        ? [[snap.id, data.title]]
        : [];
    }),
  );
  const links = live.links
    ? {
        items: live.links.items.flatMap((item, index) =>
          titles.has(item.noteId) ? [{ ...item, index, title: titles.get(item.noteId)! }] : [],
        ),
        reason: live.links.reason,
      }
    : null;
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
    title: live.title ?? null,
    reference: live.reference ?? null,
    subtasks: live.subtasks ?? null,
    // Nothing readable left: the field reads as empty.
    links: links && links.items.length > 0 ? links : null,
  };
  return {
    id: doc.id,
    boardId: doc.boardId,
    noteId: doc.noteId,
    status: doc.status,
    baseRevision: doc.baseRevision,
    fields,
    typed: doc.typed ?? [],
    kept: doc.applied
      ? {
          fields: doc.applied.fields,
          subtasks: doc.applied.subtasks ?? [],
          links: doc.applied.links ?? [],
          revision: doc.applied.revision,
        }
      : null,
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
  // Every note the caller can see, done ones too: a key in use anywhere on the board is one
  // a reference should reuse. Read only when a reference may be proposed at all.
  const fieldKeys = open.includes('reference')
    ? collectKeys(await listNotes(db, actor, board.id, { status: 'ALL' }), ctx.language)
    : [];
  const prompt = buildCapturePrompt({
    title: note.title,
    description: note.description,
    members: memberRows,
    fieldKeys,
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
  const fields = accept(
    output.fields,
    open,
    new Set(memberRows.map((m) => m.id)),
    request.today,
    note,
    fieldKeys,
  );
  if (proposedKeys(fields).length === 0) return null;

  const now = clock();
  const stamp = Timestamp.fromDate(now);
  const doc: AssistantSuggestionDoc = {
    boardId: board.id,
    noteId: note.id,
    baseRevision: note.revision,
    ...(fields.title ? { baseTitle: note.title } : {}),
    fields,
    // The chips' fields the person set, each once (R4); the title is in the first group anyway.
    typed: suggestionFieldKeys.filter(
      (key) => TYPED_KEYS.includes(key) && request.locked.includes(key),
    ),
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
  return toDto(db, board, actor.id, { ...doc, id: ref.id });
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
  decision: { source: string; fields: SuggestionFieldKey[]; subtasks?: number[] },
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

/** One write of a keep or an undo: a field, or one proposed step by its index. */
type Step = { key: SuggestionFieldKey; index?: number };

/**
 * The writes for the kept fields, in the one canonical order the chain and its receipts use,
 * with `subtasks` expanded into one step per kept index, ascending.
 */
function stepsFor(fields: SuggestionFieldKey[], subtaskIndexes: number[]): Step[] {
  return suggestionFieldKeys
    .filter((key) => fields.includes(key))
    .flatMap((key): Step[] =>
      key === 'subtasks'
        ? [...subtaskIndexes].sort((a, b) => a - b).map((index) => ({ key, index }))
        : [{ key }],
    );
}

/** A step is added with its text, and taken back by the id it was created with. */
type SubtaskWrite = { add: string } | { remove: string };

/**
 * What one direction of the chain writes. A reference whose value is null removes its key;
 * the subtask writes are keyed by the proposed step's index.
 */
type FieldValues = {
  dueDate: string | null;
  priority: NotePriority;
  assigneeId: string | null;
  title: string;
  reference: { key: string; value: string | null } | null;
  subtasks: Map<number, SubtaskWrite>;
};
type Applied = NonNullable<AssistantSuggestionDoc['applied']>;

/**
 * What a proposed date, priority or person held at `baseRevision`. One is proposed only when
 * the note has nothing there (plan R3), so these are exact for every such field a keep writes.
 */
const EMPTY = { dueDate: null, priority: 'MITTEL', assigneeId: null } as const satisfies Pick<
  FieldValues,
  'dueDate' | 'priority' | 'assigneeId'
>;

/** What a keep writes: the proposed values (a field that is not kept is never read). */
function proposedValues(doc: AssistantSuggestionDoc): FieldValues {
  const { fields } = doc;
  return {
    dueDate: fields.dueDate?.value ?? EMPTY.dueDate,
    priority: fields.priority?.value ?? EMPTY.priority,
    assigneeId: fields.assignee?.value ?? EMPTY.assigneeId,
    title: fields.title?.value ?? '',
    reference: fields.reference
      ? { key: fields.reference.key, value: fields.reference.value }
      : null,
    subtasks: new Map((fields.subtasks?.items ?? []).map((text, index) => [index, { add: text }])),
  };
}

/**
 * What puts the note back where the keep found it: the values it held before, and each kept
 * step removed by its id. `subtaskIds` follows `keptIndexes` (ascending), so a keep that
 * stopped part way restores only the steps it created.
 */
function restoredValues(
  before: Applied['before'],
  keptIndexes: number[],
  subtaskIds: string[],
): FieldValues {
  const sorted = [...keptIndexes].sort((a, b) => a - b);
  return {
    dueDate: before.dueDate,
    priority: before.priority,
    assigneeId: before.assigneeId,
    title: before.title ?? '',
    reference: before.reference
      ? { key: before.reference.key, value: before.reference.previous }
      : null,
    subtasks: new Map(
      subtaskIds.map((id, position): [number, SubtaskWrite] => [sorted[position]!, { remove: id }]),
    ),
  };
}

/** A property's value on the note, compared case-insensitively by key; null when absent. */
function propertyValue(fields: Record<string, string>, key: string): string | null {
  const found = findFieldKey(fields, key);
  return found === undefined ? null : (fields[found] ?? null);
}

/**
 * What the note held where a keep writes, read on the note the keep found. A date, a
 * priority and a person held nothing at the base (R3). The title is the one stored with the
 * proposal, and a reference's key is read only on a note still at the base: a keep that
 * resumes finds a note that already holds some of its own writes. A note with a property
 * gets no reference proposed (R7), so the key held nothing at the base otherwise.
 */
function beforeKeep(
  doc: AssistantSuggestionDoc,
  kept: SuggestionFieldKey[],
  note: NoteDetailDto,
): Applied['before'] {
  const atBase = note.revision === doc.baseRevision;
  const reference = doc.fields.reference ?? null;
  return {
    dueDate: kept.includes('dueDate') ? EMPTY.dueDate : note.dueDate,
    priority: kept.includes('priority') ? EMPTY.priority : note.priority,
    assigneeId: kept.includes('assignee') ? EMPTY.assigneeId : (note.assignee?.id ?? null),
    title: doc.baseTitle ?? note.title,
    reference: reference
      ? {
          key: reference.key,
          previous: atBase ? propertyValue(note.customFields, reference.key) : null,
        }
      : null,
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

/** The one operation that makes one step's write, with exactly the keys the strict schemas accept. */
function stepCall(
  step: Step,
  doc: Pick<AssistantSuggestionDoc, 'boardId' | 'noteId'>,
  expectedRevision: number,
  values: FieldValues,
): { name: string; input: unknown } {
  const at = { boardId: doc.boardId, noteId: doc.noteId, expectedRevision };
  switch (step.key) {
    case 'dueDate':
      return { name: 'update_note', input: { ...at, input: { dueDate: values.dueDate } } };
    case 'priority':
      return {
        name: 'move_note',
        input: { ...at, input: { mode: 'PRIORITY', priority: values.priority } },
      };
    case 'assignee':
      return { name: 'assign_note', input: { ...at, input: { assigneeId: values.assigneeId } } };
    case 'title':
      return { name: 'update_note', input: { ...at, input: { title: values.title } } };
    case 'reference': {
      const { reference } = values;
      if (!reference) throw new Error('No property to write');
      const fieldChanges =
        reference.value === null
          ? { remove: [reference.key] }
          : { set: { [reference.key]: reference.value } };
      return { name: 'update_note', input: { ...at, input: { fieldChanges } } };
    }
    case 'subtasks': {
      const write = values.subtasks.get(step.index ?? -1);
      if (!write) throw new Error(`No write for the step ${step.index}`);
      return 'add' in write
        ? { name: 'add_subtask', input: { ...at, input: { text: write.add } } }
        : { name: 'delete_subtask', input: { ...at, subtaskId: write.remove } };
    }
    case 'links':
      // Written by a later task; no record proposes links yet, so no step reaches here.
      throw new Error('No write for links yet');
  }
}

/**
 * Whether the note still shows what a step wrote, so putting it back takes nothing someone
 * changed since. A step the chain added is still there by its id. A step it removed is put
 * back only while no step with its text is on the note: an undo run again after one refused
 * part way replays the receipt of a delete an earlier revert already answered with a new
 * step, and adding it once more would double it.
 */
function stillWritten(
  step: Step,
  note: NoteDetailDto,
  written: FieldValues,
  restore: FieldValues,
): boolean {
  switch (step.key) {
    case 'title':
      return note.title === written.title;
    case 'reference':
      return (
        written.reference !== null &&
        propertyValue(note.customFields, written.reference.key) === written.reference.value
      );
    case 'subtasks': {
      const undo = restore.subtasks.get(step.index ?? -1);
      if (!undo) return false;
      return 'remove' in undo
        ? note.subtasks.some((task) => task.id === undo.remove)
        : !note.subtasks.some((task) => task.text.trim() === undo.add.trim());
    }
    default:
      return noteValue(step.key, note) === valueOf(step.key, written);
  }
}

/**
 * Writes the steps in the given order, each on the revision the previous one returned,
 * starting from `startRevision`. The chain is deterministic: run again from the same start
 * under the same ids, every write that already committed replays its receipt (same input,
 * same expected revision) and the chain picks up at the first one that did not. `done`
 * collects the steps whose write committed or replayed, so a caller can see how far it got
 * when a later write throws, and `created` the ids of the steps it added, in order.
 */
async function runChain(
  opCtx: OperationContext,
  doc: WithId<AssistantSuggestionDoc>,
  steps: Step[],
  values: FieldValues,
  ids: (step: Step) => string,
  startRevision: number,
  done: Step[],
  created: string[],
): Promise<number> {
  let revision = startRevision;
  for (const step of steps) {
    const { name, input } = stepCall(step, doc, revision, values);
    const result = await runOperation(opCtx, { name, input, operationId: ids(step) });
    revision = result.revision ?? revision;
    // A replayed receipt answers with the id the step was created with the first time.
    if (name === 'add_subtask') created.push((result.data as { id: string }).id);
    done.push(step);
  }
  return revision;
}

/** The operation id of one step; a record written before that step existed has none. */
function operationId(ids: SuggestionOperationIds, step: Step, direction: 'apply' | 'undo'): string {
  const entry = step.key === 'subtasks' ? ids.subtasks?.[step.index ?? -1] : ids[step.key];
  if (!entry) throw settled();
  return entry[direction];
}

/** A refusal that a retry under the same ids cannot change (stale, gone, forbidden, invalid). */
const isFinal = (error: unknown): error is AppError =>
  error instanceof AppError && error.statusCode < 500;

/**
 * Best effort, after a chain failed for good: puts back each step the chain wrote, newest
 * first, while the note still holds what the chain wrote there. A value someone changed
 * since is theirs and stays. These are new writes on the note's current revision, so they
 * take fresh operation ids; a failure here is logged and the next step is still tried.
 */
async function revertWrites(
  deps: SuggestionDeps,
  ctx: SuggestionContext,
  doc: WithId<AssistantSuggestionDoc>,
  done: Step[],
  written: FieldValues,
  restore: FieldValues,
): Promise<void> {
  const opCtx = operationContext(deps, ctx, doc.id);
  for (const step of [...done].reverse()) {
    try {
      const note = await getNote(deps.db, ctx.actor, doc.noteId, ctx.board.id);
      if (!stillWritten(step, note, written, restore)) continue;
      const { name, input } = stepCall(step, doc, note.revision, restore);
      await runOperation(opCtx, { name, input, operationId: randomUUID() });
    } catch (error) {
      deps.logger?.warn({
        type: 'assistant.suggestion_revert_failed',
        suggestionId: doc.id,
        field: step.key,
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
 * note changes once and each step leaves one audit record.
 *
 * A refusal that cannot change on a retry (the note changed underneath, the note is gone,
 * the assignee left, the caller lost access) ends the keep: the steps this keep did write
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
  const keptIndexes = kept.includes('subtasks')
    ? [...(doc.decision?.subtasks ?? [])].sort((a, b) => a - b)
    : [];
  const written = proposedValues(doc);
  const done: Step[] = [];
  const created: string[] = [];
  let before: Applied['before'] | undefined;
  let revision: number;
  try {
    const note = await getNote(db, ctx.actor, doc.noteId, ctx.board.id);
    before = beforeKeep(doc, kept, note);
    // The first write carries `baseRevision`, so a note changed since the proposal refuses
    // it with 409 STALE_REVISION before anything is written.
    revision = await runChain(
      operationContext(deps, ctx, doc.id),
      doc,
      stepsFor(kept, keptIndexes),
      written,
      (step) => operationId(doc.operationIds, step, 'apply'),
      doc.baseRevision,
      done,
      created,
    );
  } catch (error) {
    if (!isFinal(error)) throw error;
    if (before)
      await revertWrites(
        deps,
        ctx,
        doc,
        done,
        written,
        restoredValues(before, keptIndexes, created),
      );
    await settleKeep(db, ctx.actor, doc.id, { status: 'DISCARDED' }, deps.now?.() ?? new Date());
    throw error;
  }
  return settleKeep(
    db,
    ctx.actor,
    doc.id,
    {
      status: 'KEPT',
      applied: { before, fields: kept, subtasks: keptIndexes, subtaskIds: created, revision },
    },
    deps.now?.() ?? new Date(),
  );
}

/**
 * Keep, discard or undo (WALLYBOT_INLINE.md §4). A keep applies the kept fields, and each
 * kept step, through the command layer under the record's own operation ids, so a repeat
 * replays receipts and the note changes once; it is refused with 409 STALE_REVISION, and
 * the record discarded, when the note changed since the proposal. An undo is the inverse on
 * the kept revision: the previous values back, every kept step deleted by its id.
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
    return toDto(db, board, actor.id, doc);
  }

  if (decision.decision === 'keep') {
    const current = await loadSuggestion(db, actor, board.id, suggestionId);
    if (current.status === 'KEPT')
      return toDto(db, board, actor.id, await completeKeep(deps, ctx, current));
    // What can still be kept: an assignee who left the board since drops out here.
    const proposed = proposedKeys(liveFields(board, current.fields));
    // Each field once, in the one order the chain and its receipts use: a field named twice
    // would run its write twice under one operation id and be refused.
    const requested = decision.fields ?? proposed;
    // The title is opt-in (plan R2): the countdown never keeps it, whatever it names.
    const countdown = decision.source === 'countdown';
    let fields = suggestionFieldKeys.filter(
      (key) => requested.includes(key) && proposed.includes(key) && !(countdown && key === 'title'),
    );
    // Each step once, ascending, and only steps that were proposed; none left keeps no steps.
    const items = current.fields.subtasks?.items ?? [];
    const subtasks = fields.includes('subtasks')
      ? unique(decision.subtasks ?? items.map((_, index) => index))
          .filter((index) => index < items.length)
          .sort((a, b) => a - b)
      : [];
    if (subtasks.length === 0) fields = fields.filter((key) => key !== 'subtasks');
    // A proposal holding nothing but a title runs no countdown (R2): one that fires anyway
    // leaves the title waiting for the person, neither written nor discarded.
    // Only while the record is still pending: on a settled one the claim below answers.
    if (
      fields.length === 0 &&
      countdown &&
      proposed.includes('title') &&
      current.status === 'PENDING'
    )
      return toDto(db, board, actor.id, current);
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
      return toDto(db, board, actor.id, doc);
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
      { source: decision.source, fields, subtasks },
      now,
    );
    return toDto(db, board, actor.id, await completeKeep(deps, ctx, doc));
  }

  // undo
  let current = await loadSuggestion(db, actor, board.id, suggestionId);
  if (current.status === 'UNDONE') return toDto(db, board, actor.id, current);
  if (current.status !== 'KEPT') throw settled();
  // A keep still running or cut short finishes first, so the undo has its receipts to invert.
  current = await completeKeep(deps, ctx, current);
  if (current.status === 'UNDONE') return toDto(db, board, actor.id, current);
  const { applied } = current;
  if (current.status !== 'KEPT' || !applied) throw settled();
  // Inverse order, so each revision check sees exactly the state the keep left behind: the
  // steps newest first, then the fields. Run again after a cut-short undo, the inverse
  // writes that committed replay their receipts.
  const keptIndexes = applied.subtasks ?? [];
  const inverse = stepsFor(applied.fields, keptIndexes).reverse();
  const restore = restoredValues(applied.before, keptIndexes, applied.subtaskIds ?? []);
  const undoIds = current.operationIds;
  const done: Step[] = [];
  try {
    await runChain(
      operationContext(deps, ctx, current.id),
      current,
      inverse,
      restore,
      (step) => operationId(undoIds, step, 'undo'),
      applied.revision,
      done,
      [],
    );
  } catch (error) {
    // Refused for good part way (someone edited the note between two inverse writes): what
    // was already put back returns to what the keep wrote, so the record stays KEPT and the
    // note is not left half undone. A step deleted here comes back as a new one.
    if (isFinal(error))
      await revertWrites(deps, ctx, current, done, restore, proposedValues(current));
    throw error;
  }
  const { doc } = await claim(
    db,
    actor,
    board.id,
    suggestionId,
    'KEPT',
    'UNDONE',
    { source: decision.source, fields: [...applied.fields].reverse() },
    now,
  );
  return toDto(db, board, actor.id, doc);
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
    const stamp = Timestamp.fromDate(now);
    const col = assistantSuggestionsCol(db, actor.id);
    const refs = stale.map((doc) => col.doc(doc.id));
    // Only the status moves: no decision was taken, so none is recorded. Each record is read
    // again in the transaction, so one kept or discarded in another tab since the query is
    // left as that tab decided it.
    await db.runTransaction(async (tx) => {
      for (const snap of await tx.getAll(...refs))
        if (snap.data()?.status === 'PENDING')
          tx.update(snap.ref, { status: 'DISCARDED', updatedAt: stamp });
    });
  }
  live.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  return Promise.all(live.map((doc) => toDto(db, board, actor.id, doc)));
}
