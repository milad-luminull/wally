import type { Language } from './enums.js';

/** Fallback when no language is stored on the profile and none can be read off Accept-Language. */
export const DEFAULT_LANGUAGE: Language = 'de';

/**
 * Name given to the board auto-provisioned on a user's first request, fixed then from the
 * client's Accept-Language and never re-derived.
 *
 * Persisted data, not rendered copy — a board name is user-editable, so resolving it through
 * the UI catalogue instead would silently rename every untouched board on a language switch.
 */
export const INITIAL_BOARD_NAME: Record<Language, string> = {
  de: 'Meine Wand',
  en: 'My Board',
};

export const NOTE_TITLE_MAX_LENGTH = 200;
export const TAG_MAX_LENGTH = 40;
export const MAX_TAGS_PER_NOTE = 20;
export const SUBTASK_TEXT_MAX_LENGTH = 300;
export const FIELD_KEY_MAX_LENGTH = 40;
export const FIELD_VALUE_MAX_LENGTH = 200;
export const MAX_FIELDS_PER_NOTE = 20;
export const BOARD_NAME_MAX_LENGTH = 120;

/** Default free-canvas size in px — fixed so positions survive window resizes. */
export const FREE_CANVAS_WIDTH = 2400;
export const FREE_CANVAS_HEIGHT = 1400;
/** Rendered width of a note card — keep in sync with NoteCard's `w-[…]`. Used only to
 * clamp Frei-mode drag bounds on the client; the API does not validate against it. */
export const NOTE_CARD_WIDTH = 248;
/** Approximate rendered height of a note card — used to clamp Frei-mode drag bounds. */
export const NOTE_CARD_HEIGHT = 104;
