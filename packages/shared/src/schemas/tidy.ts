import { z } from 'zod';
import { noteHorizonSchema } from '../enums.js';

/** Undated notes one tidy call may read; the newest ones go first (plan R3). */
export const TIDY_MAX_UNDATED = 30;
/** Moves one batch may hold: every dated candidate plus what the model proposes. */
export const TIDY_MAX_MOVES = 60;
/** Below this the model's placing of an undated note is dropped. */
export const TIDY_MIN_CONFIDENCE = 0.6;

const firestoreId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'Invalid id');

/** POST /whiteboards/:id/assistant/tidies: the browser's date and zone, nothing else. */
export const tidyRequestSchema = z
  .object({
    timeZone: z.string().min(1).max(64),
    today: z.string().date(),
  })
  .strict();
export type TidyRequest = z.infer<typeof tidyRequestSchema>;

/** A move came from the date rule, or from the model reading the note's words (R3). */
export const tidyMoveSourceSchema = z.enum(['date', 'words']);
export type TidyMoveSource = z.infer<typeof tidyMoveSourceSchema>;

export const tidyMoveSchema = z.object({
  noteId: z.string(),
  /** The note revision the move was computed against; a keep skips the note past it (R5). */
  baseRevision: z.number().int().nonnegative(),
  from: noteHorizonSchema,
  to: noteHorizonSchema,
  /** The model's words for a move by words; null for a move by date (the card says the date). */
  reason: z.string().max(120).nullable(),
  source: tidyMoveSourceSchema,
});
export type TidyMove = z.infer<typeof tidyMoveSchema>;

export const tidyStatusSchema = z.enum(['PENDING', 'KEPT', 'UNDONE', 'DISCARDED']);
export type TidyStatus = z.infer<typeof tidyStatusSchema>;

export const tidyDtoSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  status: tidyStatusSchema,
  moves: z.array(tidyMoveSchema).max(TIDY_MAX_MOVES),
  /** After a keep: the notes that moved and those the keep left where they were (R5). */
  kept: z
    .object({
      noteIds: z.array(z.string()),
      skipped: z.array(z.string()),
    })
    .nullable(),
  createdAt: z.string().datetime(),
});
export type TidyDto = z.infer<typeof tidyDtoSchema>;

/** `tidy` is null when there is nothing worth moving: no record is written then. */
export const tidyResponseSchema = z.object({ tidy: tidyDtoSchema.nullable() });
export type TidyResponse = z.infer<typeof tidyResponseSchema>;

export const tidyDecisionSourceSchema = z.enum(['enter', 'esc', 'click', 'shortcut', 'remove']);
export const tidyDecisionSchema = z
  .object({
    decision: z.enum(['keep', 'discard', 'undo']),
    /** For `keep`: the notes still in the batch; omitted means every proposed move. */
    noteIds: z.array(firestoreId).max(TIDY_MAX_MOVES).optional(),
    source: tidyDecisionSourceSchema,
  })
  .strict();
export type TidyDecision = z.infer<typeof tidyDecisionSchema>;
export const tidyDecisionResponseSchema = z.object({ tidy: tidyDtoSchema });
