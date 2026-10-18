import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type {
  CaptureSuggestRequest,
  EffectiveRole,
  Language,
  NoteDetailDto,
  NoteHorizon,
  NotePriority,
  NoteVisibility,
  SuggestionDecision,
  SuggestionDto,
  SuggestionFieldKey,
  SuggestionFields,
} from '@wally/shared';
import {
  SUGGESTION_MAX_SUBTASKS,
  findFieldKey,
  suggestionFieldKeys,
  suggestionOptInFieldKeys,
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
import {
  acceptCapture,
  buildCaptureCall,
  captureCandidates,
  captureNeedsBoard,
  type CaptureContext,
} from './captureProposal.js';
import { suggestionSchemaJson, type SuggestionRunner } from './model/index.js';
import { runOperation, type OperationContext } from './run.js';

export const SUGGESTION_MAX_OUTPUT_TOKENS = 1024;
export const SUGGESTION_DEADLINE_MS = 20_000;
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
    horizon: { apply: randomUUID(), undo: randomUUID() },
    visibility: { apply: randomUUID(), undo: randomUUID(), undoAssignee: randomUUID() },
    tags: { apply: randomUUID(), undo: randomUUID() },
    properties: { apply: randomUUID(), undo: randomUUID() },
    description: { apply: randomUUID(), undo: randomUUID() },
  };
}

/** The fields the countdown never keeps (plan R2 and the smarter-capture spec). */
const optIn = (key: SuggestionFieldKey) =>
  (suggestionOptInFieldKeys as readonly SuggestionFieldKey[]).includes(key);

/** The fields a chip sets while writing: what the review's first group lists besides the words. */
const TYPED_KEYS: readonly SuggestionFieldKey[] = ['dueDate', 'priority', 'assignee'];

/** Each value once, first occurrence first. */
const unique = <T>(values: T[]): T[] => [...new Set(values)];

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
    // A record from before smarter capture has none of these: absent reads as nothing proposed.
    horizon: live.horizon ?? null,
    visibility: live.visibility ?? null,
    tags: live.tags ?? null,
    properties: live.properties ?? null,
    description: live.description ?? null,
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
          tags: doc.applied.tags ?? [],
          properties: doc.applied.properties ?? [],
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
  const members = (await listMembers(db, actor, board.id)).data;
  const captureCtx: CaptureContext = {
    actorId: actor.id,
    today: request.today,
    timeZone: request.timeZone,
    language: ctx.language,
    locked: request.locked,
    members: members.flatMap((m) =>
      m.userId ? [{ id: m.userId, name: m.displayName ?? m.email }] : [],
    ),
    canChangeVisibility: ctx.role !== 'VIEW',
  };
  const open = captureCandidates(note, captureCtx);
  if (open.length === 0) return null;
  // Every note the caller can see, done ones too, read once and only when the call uses them.
  const boardNotes = captureNeedsBoard(open)
    ? await listNotes(db, actor, board.id, { status: 'ALL' })
    : [];
  const call = buildCaptureCall(note, boardNotes, captureCtx);
  if (!call) return null;
  const { instructions, prompt } = call;
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
  const fields = acceptCapture(output.fields, call, note, captureCtx);
  if (!fields) return null;

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
  decision: {
    source: string;
    fields: SuggestionFieldKey[];
    subtasks?: number[];
    links?: number[];
    tags?: number[];
    properties?: number[];
  },
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
 * with `subtasks` expanded into one step per kept index, ascending. The kept links are one
 * write (L4), so `links` stays one step.
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

/**
 * The inverse writes, newest first. Taking Private back is two writes: shared again, then the
 * author's assignment, which making it private wrote, taken back (`index: 1`).
 */
function undoSteps(fields: SuggestionFieldKey[], subtaskIndexes: number[]): Step[] {
  return stepsFor(fields, subtaskIndexes)
    .reverse()
    .flatMap((step): Step[] =>
      step.key === 'visibility' ? [step, { key: 'visibility', index: 1 }] : [step],
    );
}

/** A step is added with its text, and taken back by the id it was created with. */
type SubtaskWrite = { add: string } | { remove: string };
/** The kept links are added in one write and taken back in one (L4). */
type LinkWrite = { add: string[] } | { remove: string[] };

/**
 * What one direction of the chain writes. A reference whose value is null removes its key;
 * the subtask writes are keyed by the proposed step's index; the links are added on a keep
 * and removed on an undo.
 */
type FieldValues = {
  dueDate: string | null;
  priority: NotePriority;
  assigneeId: string | null;
  title: string;
  reference: { key: string; value: string | null } | null;
  subtasks: Map<number, SubtaskWrite>;
  links: LinkWrite;
  horizon: NoteHorizon;
  visibility: NoteVisibility;
  /** Who a private note is assigned to: its author while private, nobody once shared again. */
  privateAssigneeId: string | null;
  tags: { add: string[] } | { remove: string[] };
  properties: { set: Record<string, string> } | { remove: string[] };
  description: string;
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

/**
 * What a keep writes: the proposed values (a field that is not kept is never read). The links
 * are every proposed one; a keep writes only the ticked ones (`keptLinkIds`).
 */
function proposedValues(doc: AssistantSuggestionDoc, actorId: string): FieldValues {
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
    links: { add: (fields.links?.items ?? []).map((item) => item.noteId) },
    horizon: fields.horizon?.value ?? 'HEUTE',
    visibility: 'PRIVATE',
    // Making a note private assigns its author (the command does it); the chain checks that.
    privateAssigneeId: actorId,
    tags: { add: fields.tags?.items ?? [] },
    properties: {
      set: Object.fromEntries((fields.properties?.items ?? []).map((p) => [p.key, p.value])),
    },
    description: fields.description?.value ?? '',
  };
}

/** The tags and properties the ticked indexes name, in the order of `indexes`. */
const keptTags = (doc: AssistantSuggestionDoc, indexes: number[]): string[] =>
  indexes.flatMap((index) => {
    const tag = doc.fields.tags?.items[index];
    return tag ? [tag] : [];
  });
const keptProperties = (doc: AssistantSuggestionDoc, indexes: number[]) =>
  indexes.flatMap((index) => {
    const item = doc.fields.properties?.items[index];
    return item ? [item] : [];
  });

/**
 * What a keep writes: the proposed values with only the ticked links, tags and properties.
 * The note had none of these at the base (L3, R7), so writing and removing them is exact.
 */
function keptValues(
  doc: AssistantSuggestionDoc,
  actorId: string,
  picked: { links: number[]; tags: number[]; properties: number[] },
): FieldValues {
  return {
    ...proposedValues(doc, actorId),
    links: { add: keptLinkIds(doc, picked.links) },
    tags: { add: keptTags(doc, picked.tags) },
    properties: {
      set: Object.fromEntries(keptProperties(doc, picked.properties).map((p) => [p.key, p.value])),
    },
  };
}

/** The ids the ticked links name, in the order of `indexes` (ascending). */
const keptLinkIds = (doc: AssistantSuggestionDoc, indexes: number[]): string[] =>
  indexes.flatMap((index) => {
    const id = doc.fields.links?.items[index]?.noteId;
    return id ? [id] : [];
  });

/**
 * What puts the note back where the keep found it: the values it held before, each kept
 * step removed by its id, and the kept links removed. `subtaskIds` follows `keptIndexes`
 * (ascending), so a keep that stopped part way restores only the steps it created. The note
 * had no links at the base (L3), so removing what the keep added is exact (L4).
 */
function restoredValues(
  before: Applied['before'],
  keptIndexes: number[],
  subtaskIds: string[],
  linkIds: string[],
  written: Pick<FieldValues, 'tags' | 'properties'> = {
    tags: { add: [] },
    properties: { set: {} },
  },
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
    links: { remove: linkIds },
    // A horizon, Private, tags, properties and a description are proposed only on a note
    // that had none (Today, shared and unassigned, no tags, no properties, no description).
    horizon: 'HEUTE',
    visibility: 'SHARED',
    privateAssigneeId: null,
    tags: { remove: 'add' in written.tags ? written.tags.add : [] },
    properties: {
      remove: 'set' in written.properties ? Object.keys(written.properties.set) : [],
    },
    description: '',
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
      return { name: 'update_note', input: { ...at, input: { linkChanges: values.links } } };
    case 'horizon':
      return {
        name: 'move_note',
        input: { ...at, input: { mode: 'HORIZON', horizon: values.horizon } },
      };
    case 'visibility':
      return step.index === 1
        ? { name: 'assign_note', input: { ...at, input: { assigneeId: values.privateAssigneeId } } }
        : { name: 'update_note', input: { ...at, input: { visibility: values.visibility } } };
    case 'tags':
      return { name: 'update_note', input: { ...at, input: { tagChanges: values.tags } } };
    case 'properties':
      return { name: 'update_note', input: { ...at, input: { fieldChanges: values.properties } } };
    case 'description':
      return { name: 'update_note', input: { ...at, input: { description: values.description } } };
  }
}

/**
 * Whether the note still shows what a step wrote, so putting it back takes nothing someone
 * changed since. A step the chain added is still there by its id. A step it removed is put
 * back only while no step with its text is on the note: an undo run again after one refused
 * part way replays the receipt of a delete an earlier revert already answered with a new
 * step, and adding it once more would double it. Links the chain added are all still on the
 * note; links it removed are put back only while none of them is there again.
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
    case 'links': {
      const links = note.links ?? [];
      return 'add' in written.links
        ? written.links.add.every((id) => links.includes(id))
        : !written.links.remove.some((id) => links.includes(id));
    }
    case 'horizon':
      return note.horizon === written.horizon;
    case 'visibility':
      return step.index === 1
        ? (note.assignee?.id ?? null) === written.privateAssigneeId
        : note.visibility === written.visibility;
    case 'tags': {
      const tags = note.tags.map((t) => t.toLowerCase());
      return 'add' in written.tags
        ? written.tags.add.every((t) => tags.includes(t.toLowerCase()))
        : !written.tags.remove.some((t) => tags.includes(t.toLowerCase()));
    }
    case 'properties':
      return 'set' in written.properties
        ? Object.entries(written.properties.set).every(
            ([key, value]) => propertyValue(note.customFields, key) === value,
          )
        : written.properties.remove.every((key) => propertyValue(note.customFields, key) === null);
    case 'description':
      return note.description === written.description;
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
  if (step.key === 'visibility' && step.index === 1) {
    if (!ids.visibility) throw settled();
    return ids.visibility.undoAssignee;
  }
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
  // Sharing a note again leaves its author assigned; the assignment goes back with it.
  const steps = [...done]
    .reverse()
    .flatMap((step): Step[] =>
      step.key === 'visibility' && step.index === undefined && restore.visibility === 'SHARED'
        ? [step, { key: 'visibility', index: 1 }]
        : [step],
    );
  for (const step of steps) {
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
  const keptLinks = kept.includes('links')
    ? [...(doc.decision?.links ?? [])].sort((a, b) => a - b)
    : [];
  const linkIds = keptLinkIds(doc, keptLinks);
  const keptTagIndexes = kept.includes('tags')
    ? [...(doc.decision?.tags ?? [])].sort((a, b) => a - b)
    : [];
  const keptPropertyIndexes = kept.includes('properties')
    ? [...(doc.decision?.properties ?? [])].sort((a, b) => a - b)
    : [];
  // Only the ticked links, tags and properties are written, each kind in one update (L4).
  const written = keptValues(doc, ctx.actor.id, {
    links: keptLinks,
    tags: keptTagIndexes,
    properties: keptPropertyIndexes,
  });
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
        restoredValues(before, keptIndexes, created, linkIds, written),
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
      applied: {
        before,
        fields: kept,
        subtasks: keptIndexes,
        subtaskIds: created,
        links: keptLinks,
        linkIds,
        tags: keptTagIndexes,
        properties: keptPropertyIndexes,
        revision,
      },
    },
    deps.now?.() ?? new Date(),
  );
}

/**
 * Keep, discard or undo (WALLYBOT_INLINE.md §4). A keep applies the kept fields, each kept
 * step, and the kept links in one write, through the command layer under the record's own
 * operation ids, so a repeat replays receipts and the note changes once; it is refused with
 * 409 STALE_REVISION, and the record discarded, when the note changed since the proposal. An undo is the inverse on
 * the kept revision: the previous values back, every kept step deleted by its id, the kept
 * links removed.
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
    // The title, its description and Private are opt-in: the countdown never keeps them,
    // whatever it names (plan R2, the smarter-capture spec).
    const countdown = decision.source === 'countdown';
    let fields = suggestionFieldKeys.filter(
      (key) => requested.includes(key) && proposed.includes(key) && !(countdown && optIn(key)),
    );
    // Each step once, ascending, and only steps that were proposed; none left keeps no steps.
    const items = current.fields.subtasks?.items ?? [];
    const subtasks = fields.includes('subtasks')
      ? unique(decision.subtasks ?? items.map((_, index) => index))
          .filter((index) => index < items.length)
          .sort((a, b) => a - b)
      : [];
    if (subtasks.length === 0) fields = fields.filter((key) => key !== 'subtasks');
    // The same for the links: each proposed item once, ascending; none left keeps no links.
    const linkItems = current.fields.links?.items ?? [];
    const links = fields.includes('links')
      ? unique(decision.links ?? linkItems.map((_, index) => index))
          .filter((index) => index < linkItems.length)
          .sort((a, b) => a - b)
      : [];
    if (links.length === 0) fields = fields.filter((key) => key !== 'links');
    // The same for the tags and the properties.
    const picked = (key: 'tags' | 'properties', requested: number[] | undefined) => {
      const count = current.fields[key]?.items.length ?? 0;
      return fields.includes(key)
        ? unique(requested ?? Array.from({ length: count }, (_, index) => index))
            .filter((index) => index < count)
            .sort((a, b) => a - b)
        : [];
    };
    const tags = picked('tags', decision.tags);
    if (tags.length === 0) fields = fields.filter((key) => key !== 'tags');
    const properties = picked('properties', decision.properties);
    if (properties.length === 0) fields = fields.filter((key) => key !== 'properties');
    // A proposal holding nothing but opt-in fields runs no countdown (R2): one that fires
    // anyway leaves them waiting for the person, neither written nor discarded.
    // Only while the record is still pending: on a settled one the claim below answers.
    if (fields.length === 0 && countdown && proposed.some(optIn) && current.status === 'PENDING')
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
      { source: decision.source, fields, subtasks, links, tags, properties },
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
  const inverse = undoSteps(applied.fields, keptIndexes);
  const linkIds = applied.linkIds ?? [];
  const written = keptValues(current, ctx.actor.id, {
    links: applied.links ?? [],
    tags: applied.tags ?? [],
    properties: applied.properties ?? [],
  });
  const restore = restoredValues(
    applied.before,
    keptIndexes,
    applied.subtaskIds ?? [],
    linkIds,
    written,
  );
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
    if (isFinal(error)) await revertWrites(deps, ctx, current, done, restore, written);
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
