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
 * Every other enum here is German domain vocabulary whose display string has to come out of
 * a label map anyway, so its wire form is free. A language tag is not domain vocabulary — it
 * is a standardised identifier that four separate consumers take verbatim: i18next's
 * `changeLanguage`, `<html lang>`, `Accept-Language`, and `Intl`. 'DE'|'EN' would buy
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

// Apricot is intentionally excluded — Finlex's design system reserves apricot for
// functional accents only (primary CTA, active-state, focus ring), never decoration.
//
// Order is append-only: the original five come first so no persisted value shifts meaning.
// Every entry needs an enums.colour.* label in BOTH message catalogues (see
// apps/web/src/i18n/), an entry in enumLabels.ts, a --note-* swatch and a --note-tint-* card tint
// (see apps/web/src/styles/globals.css, where the tints' contrast floors are documented),
// and an entry in each of the four maps in apps/web/.../util/noteDerived.ts.
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
