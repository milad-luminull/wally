import { z } from 'zod';
import {
  noteColourSchema,
  noteHorizonSchema,
  notePrioritySchema,
  noteStatusSchema,
  noteVisibilitySchema,
  noteHistoryEventTypeSchema,
} from '../enums.js';
import { userSummarySchema } from './user.js';
import { subtaskDtoSchema, subtaskSummarySchema } from './subtask.js';
import { customFieldKeySchema, customFieldsSchema } from './customField.js';
import {
  FIELD_KEY_MAX_LENGTH,
  FIELD_VALUE_MAX_LENGTH,
  MAX_FIELDS_PER_NOTE,
  MAX_LINKS_PER_NOTE,
  MAX_TAGS_PER_NOTE,
  NOTE_DESCRIPTION_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  TAG_MAX_LENGTH,
} from '../constants.js';
import { booleanQueryParam, csvEnum } from '../utils/query.js';
import { noteHorizonValues, notePriorityValues } from '../enums.js';

const tagSchema = z.string().trim().min(1).max(TAG_MAX_LENGTH);

const tagsSchema = z.array(tagSchema).max(MAX_TAGS_PER_NOTE).default([]);

/** Free text under the title. Not trimmed: leading indentation and blank lines are the
 * writer's, and only a description that is all whitespace counts as empty. */
const descriptionSchema = z.string().max(NOTE_DESCRIPTION_MAX_LENGTH);

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
  description: descriptionSchema.default(''),
  priority: notePrioritySchema.default('MITTEL'),
  horizon: noteHorizonSchema.default('HEUTE'),
  freeX: z.number().finite().default(0),
  freeY: z.number().finite().default(0),
  dueDate: z.string().date().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  tags: tagsSchema,
  /** Bare, not `.optional()`, for the same reason as `tags` above. */
  customFields: customFieldsSchema,
  colour: noteColourSchema.default('WEISS'),
  visibility: noteVisibilitySchema.default('SHARED'),
});
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;

/** A note id as the API writes them. */
const linkIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'Invalid note id');

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
    /** `''` clears it. */
    description: descriptionSchema.optional(),
    dueDate: z.string().date().nullable().optional(),
    tags: tagsSchema.optional(),
    /** Same three-state semantics as `tags`: omitted = don't touch, `{}` = clear all. */
    customFields: customFieldsSchema.optional(),
    /**
     * Changes applied to the note's CURRENT properties on the server, so two people editing
     * different properties at once both keep theirs. `customFields` replaces the whole map
     * with whatever the client last saw, and the later of two such writes drops the other.
     * Keys match existing ones case-insensitively, as everywhere else.
     */
    fieldChanges: z
      .object({
        set: customFieldsSchema.optional(),
        remove: z.array(customFieldKeySchema).max(MAX_FIELDS_PER_NOTE).optional(),
      })
      .optional(),
    /** The same for tags: added to / removed from the current list, not a replacement. */
    tagChanges: z
      .object({
        add: z.array(tagSchema).max(MAX_TAGS_PER_NOTE).optional(),
        remove: z.array(tagSchema).max(MAX_TAGS_PER_NOTE).optional(),
      })
      .optional(),
    /**
     * Related notes, added to / removed from the note's current list (the plan's L2). Each
     * added id must be a live note of the same board the caller can see, and not the note
     * itself; the server refuses the whole update otherwise.
     */
    linkChanges: z
      .object({
        add: z.array(linkIdSchema).max(MAX_LINKS_PER_NOTE).optional(),
        remove: z.array(linkIdSchema).max(MAX_LINKS_PER_NOTE).optional(),
      })
      .optional(),
    colour: noteColourSchema.optional(),
    /** Only the creator, with EDIT or OWNER, may change it. */
    visibility: noteVisibilitySchema.optional(),
  })
  .strict()
  .refine((val) => Object.keys(val).length > 0, { message: 'Empty update body' })
  .refine((val) => !(val.customFields !== undefined && val.fieldChanges !== undefined), {
    message: 'Send either customFields or fieldChanges, not both',
  })
  .refine((val) => !(val.tags !== undefined && val.tagChanges !== undefined), {
    message: 'Send either tags or tagChanges, not both',
  });
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;

/**
 * POST /notes/:id/move — the three organization-mode moves are mutually exclusive and
 * touch only their own field; see the plan's "three independent fields" decision.
 */
export const noteMoveSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('HORIZON'), horizon: noteHorizonSchema }).strict(),
  z.object({ mode: z.literal('PRIORITY'), priority: notePrioritySchema }).strict(),
  z.object({ mode: z.literal('FREE'), x: z.number().finite(), y: z.number().finite() }).strict(),
]);
export type NoteMoveInput = z.infer<typeof noteMoveSchema>;

/**
 * POST /notes/:id/duplicate — every field is optional; the server copies the rest from the
 * source note.
 *
 * `title` and `description` are what the client currently shows. The panel saves both on a
 * debounce, so the copy would otherwise miss whatever was typed in the last half second.
 * The placement fields put an Alt-dragged copy where it was dropped.
 */
export const noteDuplicateSchema = z.object({
  title: z.string().trim().max(NOTE_TITLE_MAX_LENGTH).optional(),
  description: descriptionSchema.optional(),
  horizon: noteHorizonSchema.optional(),
  priority: notePrioritySchema.optional(),
  freeX: z.number().finite().optional(),
  freeY: z.number().finite().optional(),
});
export type NoteDuplicateInput = z.infer<typeof noteDuplicateSchema>;

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
  /**
   * Custom-property filter, either `"Customer"` (note has that property at all) or
   * `"Customer:Müller GmbH"` (property equals that value). Split on the FIRST colon, so
   * values may contain colons.
   */
  field: z
    .string()
    .trim()
    .max(FIELD_KEY_MAX_LENGTH + FIELD_VALUE_MAX_LENGTH + 1)
    .optional(),
  visibility: noteVisibilitySchema.optional(),
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
  revision: z.number().int().nonnegative(),
  id: z.string(),
  whiteboardId: z.string(),
  title: z.string(),
  description: z.string(),
  status: noteStatusSchema,
  completedAt: z.string().datetime().nullable(),
  priority: notePrioritySchema,
  horizon: noteHorizonSchema,
  freeX: z.number().finite(),
  freeY: z.number().finite(),
  dueDate: z.string().date().nullable(),
  assignee: userSummarySchema.nullable(),
  tags: z.array(z.string()),
  /** Ids of the notes this one links to (L1); a reader drops an id it cannot resolve (L7). */
  links: z.array(z.string()),
  /** Permissive on the way out — the write schemas are what enforce the rules. */
  customFields: z.record(z.string(), z.string()),
  colour: noteColourSchema,
  visibility: noteVisibilitySchema,
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
