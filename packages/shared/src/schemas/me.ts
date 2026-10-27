import { z } from 'zod';
import {
  boardAxisSchema,
  boardVisibilityFilterSchema,
  boardViewSchema,
  canvasPatternSchema,
  languageSchema,
  notePrioritySchema,
  notePriorityValues,
  themePreferenceSchema,
  paletteSchema,
} from '../enums.js';
import { userSummarySchema } from './user.js';

/**
 * A board id as it may appear as a key inside `preferences.boards`. The API writes these with
 * dotted field paths (`preferences.boards.<id>`), so anything that could split or escape a
 * path segment — a dot, a backtick, a slash — is refused here rather than trusted.
 */
export const preferenceBoardIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, 'Invalid board id');

/**
 * The view settings Wally remembers per board. Search text, custom-field filters and the open
 * note are deliberately absent: they are transient, and restoring a stale search on the next
 * visit would hide notes for no visible reason.
 */
export const boardPreferencesSchema = z.object({
  view: boardViewSchema,
  axis: boardAxisSchema,
  done: z.boolean(),
  mine: z.boolean(),
  priority: z.array(notePrioritySchema).max(notePriorityValues.length),
  /** Defaulted, not required: preferences saved before this filter existed must still parse,
   *  or userPreferences() would drop the whole board entry as malformed. */
  visibility: boardVisibilityFilterSchema.default('all'),
});
export type BoardPreferences = z.infer<typeof boardPreferencesSchema>;

/** Wallybot (0005-wallybot-inline.md §3.7, decision 1): off means every proposal waits for Enter. */
export const wallybotPreferencesSchema = z.object({ autoApply: z.boolean() });
export type WallybotPreferences = z.infer<typeof wallybotPreferencesSchema>;
export const DEFAULT_WALLYBOT_PREFERENCES: WallybotPreferences = { autoApply: true };

export const preferencesSchema = z.object({
  theme: themePreferenceSchema,
  palette: paletteSchema.default('paper'),
  canvas: canvasPatternSchema,
  /** The board `/` opens. Not access-checked here — the client only honours it if the id is
   *  still among the caller's boards. */
  lastBoardId: preferenceBoardIdSchema.nullable(),
  boards: z.record(preferenceBoardIdSchema, boardPreferencesSchema),
  /** Defaulted: preferences saved before Wallybot existed must still parse. */
  wallybot: wallybotPreferencesSchema.default(DEFAULT_WALLYBOT_PREFERENCES),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  palette: 'paper',
  canvas: 'dots',
  lastBoardId: null,
  boards: {},
  wallybot: DEFAULT_WALLYBOT_PREFERENCES,
};

/**
 * A partial update. Each named board is replaced whole, `null` forgets it ("reset view"), and
 * boards not named are left alone — two tabs saving different boards never overwrite each
 * other.
 */
export const preferencesUpdateSchema = z
  .object({
    theme: themePreferenceSchema.optional(),
    palette: paletteSchema.optional(),
    canvas: canvasPatternSchema.optional(),
    lastBoardId: preferenceBoardIdSchema.optional(),
    wallybot: wallybotPreferencesSchema.optional(),
    boards: z
      .record(preferenceBoardIdSchema, boardPreferencesSchema.nullable())
      .refine((boards) => Object.keys(boards).length <= 20, 'Too many boards in one update')
      .optional(),
  })
  .strict();
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>;

/**
 * The signed-in caller's own profile.
 *
 * Built by extending `userSummarySchema` so id/email/displayName cannot drift apart from the
 * embedded shape — but `language` and `preferences` are added HERE and must never move down
 * into `userSummarySchema` itself. That shape is embedded in *other people's* DTOs: a note's
 * assignee and createdBy, and every row of the members list. Carrying them there would ship
 * every board member's UI preferences to every other member, for no consumer at all.
 *
 * `emailVerified` is deliberately absent too: the web already holds it reactively from
 * Firebase and renders the verification banner off that, so a server-side copy would be a
 * second source of truth for the same flag.
 */
export const meDtoSchema = userSummarySchema.extend({
  language: languageSchema,
  preferences: preferencesSchema,
});
export type MeDto = z.infer<typeof meDtoSchema>;

/** The mutable part of a profile — email and displayName are Firebase's to own. */
export const meUpdateSchema = z
  .object({
    language: languageSchema.optional(),
    preferences: preferencesUpdateSchema.optional(),
  })
  .strict()
  .refine((body) => body.language !== undefined || body.preferences !== undefined, {
    message: 'Nothing to update',
  });
export type MeUpdateInput = z.infer<typeof meUpdateSchema>;
