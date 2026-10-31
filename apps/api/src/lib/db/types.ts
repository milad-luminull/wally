import type {
  BoardPreferences,
  CanvasPattern,
  NoteHorizon,
  NotePriority,
  Palette,
  SuggestionFieldKey,
  ThemePreference,
  TidyMoveSource,
  WhiteboardRole,
} from '@wally/shared';
import type {
  assistantAttempts,
  assistantAudit,
  assistantConversations,
  assistantSpend,
  assistantSuggestions,
  assistantTidies,
  assistantUsage,
  authIdentities,
  boardMembers,
  mcpConnections,
  noteHistory,
  notes,
  shareLinks,
  subtasks,
  users,
  whiteboards,
} from '../postgres/schema/index.js';

/**
 * Row types, as Drizzle reads them: instants are `Date`, calendar days 'YYYY-MM-DD'
 * strings. Instants inside jsonb values are ISO strings, since JSON has no instant type.
 */
export type UserRow = typeof users.$inferSelect;
export type AuthIdentityRow = typeof authIdentities.$inferSelect;
export type McpConnectionRow = typeof mcpConnections.$inferSelect;
export type WhiteboardRow = typeof whiteboards.$inferSelect;
export type MemberRow = typeof boardMembers.$inferSelect;
export type ShareLinkRow = typeof shareLinks.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type SubtaskRow = typeof subtasks.$inferSelect;
export type HistoryRow = typeof noteHistory.$inferSelect;
export type AssistantAuditRow = typeof assistantAudit.$inferSelect;
export type AssistantUsageRow = typeof assistantUsage.$inferSelect;
export type AssistantSpendRow = typeof assistantSpend.$inferSelect;
export type AssistantAttemptRow = typeof assistantAttempts.$inferSelect;
export type AssistantConversationRow = typeof assistantConversations.$inferSelect;
export type AssistantSuggestionRow = typeof assistantSuggestions.$inferSelect;
export type AssistantTidyRow = typeof assistantTidies.$inferSelect;

/**
 * A board as every access check reads it: the row, the roles of its ACTIVE members by user
 * id, and its share link's token (see liveBoard in records.ts).
 */
export type Board = WhiteboardRow & {
  memberRoles: Record<string, WhiteboardRole>;
  shareLinkToken: string | null;
};

/** A note with its subtask counts, which every NoteDto carries (see loadNote). */
export type Note = NoteRow & { subtaskSummary: { total: number; done: number } };

/**
 * UI preferences: theme, the board `/` opens, and per-board view settings. Empty until the
 * user first changes one, and only ever written by PATCH /me — read it through
 * userPreferences(), which also drops anything malformed.
 */
export type StoredPreferences = {
  theme?: ThemePreference;
  palette?: Palette;
  canvas?: CanvasPattern;
  lastBoardId?: string | null;
  /** `touchedAt` (epoch ms) orders the pruning past MAX_REMEMBERED_BOARDS; never sent out. */
  boards?: Record<string, BoardPreferences & { touchedAt: number }>;
  wallybot?: { autoApply?: boolean };
};

/** One visible entry of an assistant conversation, as the panel shows it. */
export type AssistantEntry = {
  role: 'user' | 'assistant';
  text: string;
  chips: { id: string; title: string }[];
  partial: boolean;
  stopped: 'TOOL_LIMIT' | 'TIMEOUT' | 'LENGTH' | null;
  /** ISO instant. */
  at: string;
};

export type ConversationUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

/**
 * One operation id per write and per direction, minted when the suggestion is created. The
 * subtask ids are indexed like the proposed items.
 */
export type SuggestionOperationIds = {
  dueDate: { apply: string; undo: string };
  priority: { apply: string; undo: string };
  assignee: { apply: string; undo: string };
  title?: { apply: string; undo: string };
  reference?: { apply: string; undo: string };
  subtasks?: { apply: string; undo: string }[];
  links?: { apply: string; undo: string };
  horizon?: { apply: string; undo: string };
  /** An undo of Private is two writes: shared again, then the author's assignment taken back. */
  visibility?: { apply: string; undo: string; undoAssignee: string };
  tags?: { apply: string; undo: string };
  properties?: { apply: string; undo: string };
  description?: { apply: string; undo: string };
};

/** What a capture proposes, field by field (RFC-0003 §3.2, RFC-0005 §4). */
export type SuggestionFields = {
  dueDate: { value: string; reason: string } | null;
  priority: { value: 'HIGH' | 'LOW'; reason: string } | null;
  /** A user id; the DTO resolves it to a summary at read time. */
  assignee: { value: string; reason: string } | null;
  title?: { value: string; reason: string } | null;
  reference?: { key: string; value: string; reason: string } | null;
  subtasks?: { items: string[]; reason: string } | null;
  links?: { items: { noteId: string; reason: string }[]; reason: string } | null;
  horizon?: { value: 'THIS_WEEK' | 'LATER'; reason: string } | null;
  visibility?: { value: 'PRIVATE'; reason: string } | null;
  tags?: { items: string[]; reason: string } | null;
  properties?: { items: { key: string; value: string }[]; reason: string } | null;
  description?: { value: string; reason: string } | null;
};

export type SuggestionDecision = {
  source: string;
  fields: SuggestionFieldKey[];
  /** For a keep with subtasks: the indexes of the items the person kept. */
  subtasks?: number[];
  /** For a keep with links: the indexes of the items the person kept. */
  links?: number[];
  /** For a keep with tags or properties: the indexes of the items the person kept. */
  tags?: number[];
  properties?: number[];
  /** ISO instant. */
  at: string;
};

/** Written by an undo, beside the keep's `decision`, which stays as the keep recorded it. */
export type SuggestionUndone = { source: string; at: string };

/** Written by a keep: what the note held before, and the revision the keep produced. */
export type SuggestionApplied = {
  before: {
    dueDate: string | null;
    priority: NotePriority;
    assigneeId: string | null;
    title?: string;
    /** The key's previous value, or null when the key was not on the note. */
    reference?: { key: string; previous: string | null } | null;
  };
  fields: SuggestionFieldKey[];
  /** The kept indexes of the proposed subtasks. */
  subtasks?: number[];
  /** The ids the kept subtasks were created with, in index order of the kept items. */
  subtaskIds?: string[];
  /** The kept indexes of the proposed links, and the ids they named. */
  links?: number[];
  linkIds?: string[];
  /** The kept indexes of the proposed tags and properties. */
  tags?: number[];
  properties?: number[];
  revision: number;
};

export type SuggestionUsage = { inputTokens: number; outputTokens: number };

/** One proposed horizon move of a Tidy, with its apply and undo operation ids. */
export type TidyMove = {
  noteId: string;
  baseRevision: number;
  from: NoteHorizon;
  to: NoteHorizon;
  reason: string | null;
  source: TidyMoveSource;
  operationIds: { apply: string; undo: string };
};

/** The keep or discard: the chosen notes for a keep; `replaced` when a newer tidy discarded it. */
export type TidyDecision = { source: string; noteIds: string[]; at: string };

/** The undo, with the notes it moved back (in the order it moved them). */
export type TidyUndone = { source: string; noteIds: string[]; at: string };

/** Written by a keep: each note that moved with the revision the move produced, and the skipped ones. */
export type TidyApplied = { moves: { noteId: string; revision: number }[]; skipped: string[] };
