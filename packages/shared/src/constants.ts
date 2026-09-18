import type {
  NoteColour,
  NoteHorizon,
  NotePriority,
  ReferenceType,
  WhiteboardRole,
  EffectiveRole,
} from './enums.js';

/** Shared German copy for enum values — one source of truth for API and UI. */

export const PRIORITY_LABELS: Record<NotePriority, string> = {
  HOCH: 'Hoch',
  MITTEL: 'Mittel',
  NIEDRIG: 'Niedrig',
};

export const HORIZON_LABELS: Record<NoteHorizon, string> = {
  HEUTE: 'Heute',
  DIESE_WOCHE: 'Diese Woche',
  SPAETER: 'Später',
};

export const COLOUR_LABELS: Record<NoteColour, string> = {
  WEISS: 'Ohne',
  EIS: 'Eisblau',
  SAND: 'Sand',
  MINZE: 'Minze',
  HIMMEL: 'Himmel',
};

export const REFERENCE_TYPE_LABELS: Record<ReferenceType, string> = {
  KUNDE: 'Kunde',
  VERTRAG: 'Vertrag',
  SCHADEN: 'Schaden',
};

export const WHITEBOARD_ROLE_LABELS: Record<WhiteboardRole, string> = {
  VIEW: 'Ansehen',
  EDIT: 'Bearbeiten',
};

export const EFFECTIVE_ROLE_LABELS: Record<EffectiveRole, string> = {
  OWNER: 'Eigentümer',
  EDIT: 'Bearbeiten',
  VIEW: 'Ansehen',
};

export const NOTE_TITLE_MAX_LENGTH = 200;
export const TAG_MAX_LENGTH = 40;
export const MAX_TAGS_PER_NOTE = 20;
export const SUBTASK_TEXT_MAX_LENGTH = 300;
export const REFERENCE_LABEL_MAX_LENGTH = 200;
export const BOARD_NAME_MAX_LENGTH = 120;

/** Default free-canvas size in px — fixed so positions survive window resizes. */
export const FREE_CANVAS_WIDTH = 2400;
export const FREE_CANVAS_HEIGHT = 1400;
export const NOTE_CARD_WIDTH = 216;
/** Approximate rendered height of a note card — used to clamp Frei-mode drag bounds. */
export const NOTE_CARD_HEIGHT = 96;
