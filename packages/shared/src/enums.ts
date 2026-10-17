import { z } from 'zod';

/**
 * The single source of truth for these value sets, on both sides of the API. Firestore
 * stores them as these exact strings — it has no enum type of its own and validates
 * nothing on write, so a value that isn't listed here will be persisted quite happily.
 */

/**
 * UI language, stored on the user profile.
 *
 * Lowercase BCP-47 rather than the SCREAMING style of the value sets below, deliberately.
 * Every other enum here is domain vocabulary whose display string has to come out of a label
 * map anyway, so its wire form is free. Several of those values are still German (`HOCH`,
 * `HEUTE`, `WEISS`, `wand`); they are migrated to English in place, in the expand-and-contract
 * sequence of ADR-0014 (steps 4 to 6), so until that release the arrays below do not change.
 * A language tag is not domain vocabulary — it is a standardised identifier that four
 * separate consumers take verbatim: i18next's `changeLanguage`, `<html lang>`,
 * `Accept-Language`, and `Intl`. 'DE'|'EN' would buy
 * file-local consistency at the price of a Language->locale map and its inverse, applied at
 * every one of those boundaries.
 */
export const languageValues = ['de', 'en'] as const;
export const languageSchema = z.enum(languageValues);
export type Language = z.infer<typeof languageSchema>;

export const notePriorityValues = ['HOCH', 'MITTEL', 'NIEDRIG'] as const;
export const notePrioritySchema = z.enum(notePriorityValues);
export type NotePriority = z.infer<typeof notePrioritySchema>;

export const noteHorizonValues = ['HEUTE', 'DIESE_WOCHE', 'SPAETER'] as const;
export const noteHorizonSchema = z.enum(noteHorizonValues);
export type NoteHorizon = z.infer<typeof noteHorizonSchema>;

// Dusty blue is intentionally excluded — the brand guideline reserves it for functional use
// only (the pin in the mark, one CTA per screen, the selection state), and separately notes
// that a blue note would read as selected. See docs/BRAND.md.
//
// Order is append-only: the original five come first so no persisted value shifts meaning.
// These fourteen names predate the brand guideline, which specifies seven; seven of the
// entries below now carry a guideline colour exactly and seven are derived into the same
// linen-dyed family, so nothing here had to be renamed or migrated in Firestore.
//
// Every entry needs an enums.colour.* label in BOTH message catalogues (see
// apps/web/src/i18n/), an entry in enumLabels.ts, a --note-* fill (see
// apps/web/src/styles/globals.css, where the contrast floors are documented), and an entry
// in noteColourFillClass in apps/web/.../util/noteDerived.ts.
export const noteColourValues = [
  'WEISS',
  'EIS',
  'SAND',
  'MINZE',
  'HIMMEL',
  'NEBEL',
  'BUTTER',
  'LEHM',
  'ROSE',
  'MALVE',
  'FLIEDER',
  'SEEGRUEN',
  'SALBEI',
  'OLIV',
] as const;
export const noteColourSchema = z.enum(noteColourValues);
export type NoteColour = z.infer<typeof noteColourSchema>;

export const noteStatusValues = ['OPEN', 'DONE'] as const;
export const noteStatusSchema = z.enum(noteStatusValues);
export type NoteStatus = z.infer<typeof noteStatusSchema>;

/** Who sees a note. `PRIVATE` notes are visible to, and always assigned to, their creator. */
export const noteVisibilityValues = ['SHARED', 'PRIVATE'] as const;
export const noteVisibilitySchema = z.enum(noteVisibilityValues);
export type NoteVisibility = z.infer<typeof noteVisibilitySchema>;

/** The board's visibility filter: every note, only your private ones, or none of them. */
export const boardVisibilityFilterValues = ['all', 'private', 'shared'] as const;
export const boardVisibilityFilterSchema = z.enum(boardVisibilityFilterValues);
export type BoardVisibilityFilter = z.infer<typeof boardVisibilityFilterSchema>;

export const whiteboardRoleValues = ['VIEW', 'EDIT'] as const;
export const whiteboardRoleSchema = z.enum(whiteboardRoleValues);
export type WhiteboardRole = z.infer<typeof whiteboardRoleSchema>;

/** Synthetic role including the board owner, used for authorization checks and DTOs. */
export const effectiveRoleValues = ['OWNER', 'EDIT', 'VIEW'] as const;
export const effectiveRoleSchema = z.enum(effectiveRoleValues);
export type EffectiveRole = z.infer<typeof effectiveRoleSchema>;

export const membershipStatusValues = ['PENDING', 'ACTIVE'] as const;
export const membershipStatusSchema = z.enum(membershipStatusValues);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const noteHistoryEventTypeValues = ['CREATED', 'MOVED'] as const;
export const noteHistoryEventTypeSchema = z.enum(noteHistoryEventTypeValues);
export type NoteHistoryEventType = z.infer<typeof noteHistoryEventTypeSchema>;

export const noteMoveModeValues = ['HORIZON', 'PRIORITY', 'FREE'] as const;
export const noteMoveModeSchema = z.enum(noteMoveModeValues);
export type NoteMoveMode = z.infer<typeof noteMoveModeSchema>;

/**
 * How the board renders: the spatial wall, or the dense list. The wall's stored value is
 * still the German `wand`; ADR-0014 step 4 migrates it to `wall` (the code already says wall).
 */
export const boardViewValues = ['wand', 'list'] as const;
export const boardViewSchema = z.enum(boardViewValues);
export type BoardView = z.infer<typeof boardViewSchema>;

/** What the wall is grouped by. */
export const boardAxisValues = ['horizon', 'priority', 'free'] as const;
export const boardAxisSchema = z.enum(boardAxisValues);
export type BoardAxis = z.infer<typeof boardAxisSchema>;

/** `system` follows the OS's prefers-color-scheme. */
export const themePreferenceValues = ['system', 'light', 'dark'] as const;
export const themePreferenceSchema = z.enum(themePreferenceValues);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

/** The free canvas's backdrop: a sparse dot grid, a faint line grid, or nothing. */
export const canvasPatternValues = ['dots', 'grid', 'none'] as const;
export const canvasPatternSchema = z.enum(canvasPatternValues);
export type CanvasPattern = z.infer<typeof canvasPatternSchema>;
