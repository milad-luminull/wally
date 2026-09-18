import { z } from 'zod';
import {
  noteColourSchema,
  noteHorizonSchema,
  notePrioritySchema,
  noteStatusSchema,
  referenceTypeSchema,
  noteHistoryEventTypeSchema,
} from '../enums.js';
import { userSummarySchema } from './user.js';
import { subtaskDtoSchema, subtaskSummarySchema } from './subtask.js';
import {
  MAX_TAGS_PER_NOTE,
  NOTE_TITLE_MAX_LENGTH,
  REFERENCE_LABEL_MAX_LENGTH,
  TAG_MAX_LENGTH,
} from '../constants.js';
import { booleanQueryParam, csvEnum } from '../utils/query.js';
import { noteHorizonValues, notePriorityValues } from '../enums.js';

const tagsSchema = z
  .array(z.string().trim().min(1).max(TAG_MAX_LENGTH))
  .max(MAX_TAGS_PER_NOTE)
  .default([]);

/**
 * POST /whiteboards/:id/notes
 *
 * `title` deliberately has no `.min(1)` — a note created from a canvas double-click
 * starts blank ("Ohne Titel" in the UI) and is titled afterwards via the detail panel,
 * matching the reference mockup's behavior. `.default('')` only applies when `title` is
 * omitted entirely; since there's no `.min(1)` to conflict with it, an omitted title and
 * an explicit `""` both correctly resolve to `''`.
 *
 * `tags` uses `tagsSchema` directly (not `.optional()`) so an omitted `tags` resolves
 * through `tagsSchema`'s own `.default([])` to `[]` rather than to `undefined` — wrapping
 * an already-defaulted schema in `.optional()` would short-circuit before that default
 * ever ran.
 */
export const noteCreateSchema = z.object({
  title: z.string().trim().max(NOTE_TITLE_MAX_LENGTH).default(''),
  priority: notePrioritySchema.default('MITTEL'),
  horizon: noteHorizonSchema.default('HEUTE'),
  freeX: z.number().default(0),
  freeY: z.number().default(0),
  dueDate: z.string().date().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  referenceType: referenceTypeSchema.nullable().optional(),
  referenceLabel: z.string().trim().max(REFERENCE_LABEL_MAX_LENGTH).nullable().optional(),
  tags: tagsSchema,
  colour: noteColourSchema.default('WEISS'),
});
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;

/**
 * PATCH /notes/:id — only the fields that aren't handled by their own dedicated route.
 *
 * `title` allows clearing to `''` (no `.min(1)`) — a note can legitimately go back to
 * "Ohne Titel", same reasoning as `noteCreateSchema`.
 *
 * `tags` keeps `.optional()` here (unlike create): PATCH semantics need three distinct
 * states — omitted means "don't touch tags", `[]` means "clear all tags", a non-empty
 * array means "replace with these". `tagsSchema`'s own `.default([])` never actually
 * fires in this position (an explicit `[]` already validates via the inner array schema
 * without needing the default) — it's simply inert here, not wrong.
 */
export const noteUpdateSchema = z
  .object({
    title: z.string().trim().max(NOTE_TITLE_MAX_LENGTH).optional(),
    dueDate: z.string().date().nullable().optional(),
    referenceType: referenceTypeSchema.nullable().optional(),
    referenceLabel: z.string().trim().max(REFERENCE_LABEL_MAX_LENGTH).nullable().optional(),
    tags: tagsSchema.optional(),
    colour: noteColourSchema.optional(),
  })
  .refine((val) => Object.keys(val).length > 0, { message: 'Empty update body' });
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;

/**
 * POST /notes/:id/move — the three organization-mode moves are mutually exclusive and
 * touch only their own field; see the plan's "three independent fields" decision.
 */
export const noteMoveSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('HORIZON'), horizon: noteHorizonSchema }),
  z.object({ mode: z.literal('PRIORITY'), priority: notePrioritySchema }),
  z.object({ mode: z.literal('FREE'), x: z.number(), y: z.number() }),
]);
export type NoteMoveInput = z.infer<typeof noteMoveSchema>;

/** POST /notes/:id/assign */
export const noteAssignSchema = z.object({
  assigneeId: z.string().nullable(),
});
export type NoteAssignInput = z.infer<typeof noteAssignSchema>;

/** GET /whiteboards/:id/notes query params */
export const noteListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  priority: csvEnum(notePriorityValues),
  horizon: csvEnum(noteHorizonValues),
  assignedToMe: booleanQueryParam,
  status: z.enum(['OPEN', 'DONE', 'ALL']).optional().default('ALL'),
});
export type NoteListQuery = z.infer<typeof noteListQuerySchema>;

export const historyEventDtoSchema = z.object({
  id: z.string(),
  type: noteHistoryEventTypeSchema,
  occurredAt: z.string().datetime(),
  actor: userSummarySchema.nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type HistoryEventDto = z.infer<typeof historyEventDtoSchema>;

/** Shape returned in list responses — kept light, no subtasks[]/history[]. */
export const noteDtoSchema = z.object({
  id: z.string(),
  whiteboardId: z.string(),
  title: z.string(),
  status: noteStatusSchema,
  completedAt: z.string().datetime().nullable(),
  priority: notePrioritySchema,
  horizon: noteHorizonSchema,
  freeX: z.number(),
  freeY: z.number(),
  dueDate: z.string().date().nullable(),
  assignee: userSummarySchema.nullable(),
  referenceType: referenceTypeSchema.nullable(),
  referenceLabel: z.string().nullable(),
  tags: z.array(z.string()),
  colour: noteColourSchema,
  subtaskSummary: subtaskSummarySchema,
  createdBy: userSummarySchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type NoteDto = z.infer<typeof noteDtoSchema>;

/** Shape returned from GET /notes/:id — full detail including subtasks and history. */
export const noteDetailDtoSchema = noteDtoSchema.extend({
  subtasks: z.array(subtaskDtoSchema),
  history: z.array(historyEventDtoSchema),
});
export type NoteDetailDto = z.infer<typeof noteDetailDtoSchema>;
