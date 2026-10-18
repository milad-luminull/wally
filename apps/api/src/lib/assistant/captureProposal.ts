import type { Language, NoteDetailDto, NoteDto, SuggestionFieldKey } from '@wally/shared';
import {
  SUGGESTION_MAX_LINKS,
  customFieldKeySchema,
  customFieldValueSchema,
  foldFieldKey,
} from '@wally/shared';
import type { AssistantSuggestionDoc } from '../db/types.js';
import {
  CAPTURE_MAX_OTHER_NOTES,
  buildCaptureInstructions,
  buildCapturePrompt,
} from './capturePrompt.js';
import type { ModelSuggestion } from './model/index.js';

/**
 * The capture call without Firestore (WALLYBOT_INLINE.md §3.3): which fields may be proposed,
 * what the model is told, and what of its answer survives. The route reads the note and the
 * board and stores the record; the scoring script (`capture-eval.ts`) runs the same functions
 * on fixtures, so what it scores is what the person gets.
 */

/** What the capture reads of the note just written. */
export type CaptureNote = Pick<
  NoteDetailDto,
  | 'id'
  | 'title'
  | 'description'
  | 'dueDate'
  | 'priority'
  | 'assignee'
  | 'visibility'
  | 'horizon'
  | 'tags'
  | 'customFields'
  | 'subtaskSummary'
  | 'links'
  | 'createdBy'
>;
/** What the capture reads of the board's other notes (every one the caller can see). */
export type CaptureBoardNote = Pick<
  NoteDto,
  | 'id'
  | 'title'
  | 'status'
  | 'createdAt'
  | 'visibility'
  | 'horizon'
  | 'priority'
  | 'tags'
  | 'customFields'
  | 'createdBy'
>;
export interface CaptureContext {
  actorId: string;
  today: string;
  timeZone: string;
  language: Language;
  /** The fields the person decided while writing; never proposed. */
  locked: SuggestionFieldKey[];
  /** The board's members as `id: name` rows; an assignee must be one of them. */
  members: { id: string; name: string }[];
  /** Whether the caller may change who sees a note (the command layer's rule: not a viewer). */
  canChangeVisibility: boolean;
}
/** One call's input and what its answer is checked against. */
export interface CaptureCall {
  open: SuggestionFieldKey[];
  instructions: string;
  prompt: string;
  /** The other notes the model was shown, id to title: what a link may name. */
  others: Map<string, string>;
  /** The board's property keys the model was shown: what a property's key folds to. */
  fieldKeys: string[];
}

/** Below this the model's guess is dropped (the brief: low-confidence fields dropped). */
export const SUGGESTION_MIN_CONFIDENCE = 0.6;
/** Fewer steps than this are no breakdown: steps are proposed two to five (plan R7). */
export const SUGGESTION_MIN_SUBTASKS = 2;

/**
 * Which fields may be proposed for this note: an empty one the person did not decide while
 * writing (plan R3), a cleaner title beside a title they wrote, a reference or steps only on a
 * note that has no property and no step yet (R7), and links only on a note with none (L3).
 */
export function captureCandidates(
  note: CaptureNote,
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
  if ((note.links ?? []).length === 0 && !locked.includes('links')) open.push('links');
  return open;
}

/** Whether the call needs the board's notes at all; when not, the route skips reading them. */
export function captureNeedsBoard(open: SuggestionFieldKey[]): boolean {
  return open.includes('reference') || open.includes('links');
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

/**
 * The instructions and the prompt for one capture, or null when nothing may be proposed (no
 * call is made then).
 */
export function buildCaptureCall(
  note: CaptureNote,
  boardNotes: CaptureBoardNote[],
  ctx: CaptureContext,
): CaptureCall | null {
  const open = captureCandidates(note, ctx.locked);
  if (open.length === 0) return null;
  // A key in use anywhere on the board is one a reference should reuse.
  const fieldKeys = open.includes('reference') ? collectKeys(boardNotes, ctx.language) : [];
  // The other open notes, newest first, as `id: title` rows: what a link may name (L3).
  const otherNotes = open.includes('links')
    ? boardNotes
        .filter((n) => n.id !== note.id && n.status === 'OPEN')
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .slice(0, CAPTURE_MAX_OTHER_NOTES)
        .map((n) => ({ id: n.id, title: n.title }))
    : [];
  // Links are offered only when the board has another open note to name (L3): with none, a
  // note whose other fields are all decided costs no call.
  const proposable = otherNotes.length ? open : open.filter((key) => key !== 'links');
  if (proposable.length === 0) return null;
  return {
    open: proposable,
    instructions: buildCaptureInstructions({
      today: ctx.today,
      timeZone: ctx.timeZone,
      language: ctx.language,
    }),
    prompt: buildCapturePrompt({
      title: note.title,
      description: note.description,
      members: ctx.members,
      fieldKeys,
      notes: otherNotes,
    }),
    others: new Map(otherNotes.map((n) => [n.id, n.title])),
    fieldKeys,
  };
}

/**
 * Keeps a field only when it is a candidate, confident enough, (for a person) a member and
 * (for a link) one of the other notes the model was shown. A due date before the person's
 * today is dropped: nobody writes a task that was due last week. Both are YYYY-MM-DD, so the
 * string order is the calendar order. Null when nothing survived.
 */
export function acceptCapture(
  fields: ModelSuggestion,
  call: CaptureCall,
  note: CaptureNote,
  ctx: CaptureContext,
): AssistantSuggestionDoc['fields'] | null {
  const { open } = call;
  const sure = (c: number) => c >= SUGGESTION_MIN_CONFIDENCE;
  const memberIds = new Set(ctx.members.map((m) => m.id));
  const accepted: AssistantSuggestionDoc['fields'] = {
    dueDate:
      open.includes('dueDate') &&
      fields.dueDate &&
      sure(fields.dueDate.confidence) &&
      fields.dueDate.value >= ctx.today
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
    // Until several properties can be kept, the first one proposed is the note's reference.
    reference:
      open.includes('reference') &&
      fields.properties &&
      fields.properties.items[0] &&
      sure(fields.properties.confidence)
        ? acceptReference(
            { ...fields.properties.items[0], reason: fields.properties.reason },
            call.fieldKeys,
          )
        : null,
    subtasks:
      open.includes('subtasks') && fields.subtasks && sure(fields.subtasks.confidence)
        ? acceptSubtasks(fields.subtasks)
        : null,
    links:
      open.includes('links') && fields.links && sure(fields.links.confidence)
        ? acceptLinks(fields.links, call.others)
        : null,
  };
  return Object.values(accepted).some((value) => (value ?? null) !== null) ? accepted : null;
}

/**
 * The key folds to the board's own spelling when the board already uses it ("customer" becomes
 * "Customer"), so a keep never starts a near-duplicate property. A key or value the property
 * schema refuses drops the reference.
 */
function acceptReference(
  reference: { key: string; value: string; reason: string },
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

/**
 * Only notes from the rows the model saw, each once, at most three: a link is never invented
 * (L3). The rows never hold the note itself, and the runner already dropped repeated ids.
 */
function acceptLinks(
  links: NonNullable<ModelSuggestion['links']>,
  others: Map<string, string>,
): NonNullable<AssistantSuggestionDoc['fields']['links']> | null {
  const items = links.items
    .filter((item) => others.has(item.noteId))
    .slice(0, SUGGESTION_MAX_LINKS)
    .map((item) => ({ noteId: item.noteId, reason: item.reason }));
  return items.length ? { items, reason: links.reason } : null;
}
