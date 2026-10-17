import type { Timestamp } from 'firebase-admin/firestore';
import type {
  BoardCommand,
  BoardPreferences,
  CanvasPattern,
  Language,
  MembershipStatus,
  NoteColour,
  NoteHistoryEventType,
  NoteHorizon,
  NotePriority,
  NoteStatus,
  NoteVisibility,
  SuggestionFieldKey,
  ThemePreference,
  WhiteboardRole,
} from '@wally/shared';

/**
 * Stored document shapes. Declared as `type` rather than `interface` so they satisfy
 * Firestore's DocumentData index signature.
 *
 * A document's id is not part of its data — reads attach it via `WithId` (see
 * collections.ts), which is what the DTO mappers consume.
 */
export type WithId<T> = T & { id: string };

export type UserDoc = {
  /** Always stored lowercase — see normalizeEmail in collections.ts. */
  email: string;
  displayName: string | null;
  /**
   * Whether Firebase has confirmed this person controls `email`. Mirrored from the ID
   * token by provisionUser. Firebase permits sign-up with someone else's address, so an
   * unverified record is never proof of ownership — every privilege decision keyed on
   * email (upsertInvite, redeemShareLink) must read this first.
   *
   * Declared required so every writer has to supply it, but records written before the
   * field existed carry no value at all: read it through isEmailVerified(), never
   * directly, except in the provisioning comparison that deliberately backfills them.
   */
  emailVerified: boolean;
  /**
   * The user's chosen UI language. Seeded at provisioning from Accept-Language and changed
   * only by PATCH /me — never re-derived from a header afterwards, or someone who picked
   * English would be flipped back every time they opened the app on a German-locale machine.
   *
   * Declared required so every writer has to supply it, but — exactly as with emailVerified
   * above — records written before the field existed carry no value at all: read it through
   * userLanguage(), never directly.
   */
  language: Language;
  /**
   * UI preferences: theme, the board `/` opens, and per-board view settings. Absent on every
   * record until the user first changes one, and only ever written by PATCH /me with dotted
   * field paths — read it through userPreferences(), which also drops anything malformed.
   */
  preferences?: StoredPreferences;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type StoredPreferences = {
  theme?: ThemePreference;
  canvas?: CanvasPattern;
  lastBoardId?: string | null;
  /** `touchedAt` (epoch ms) orders the pruning past MAX_REMEMBERED_BOARDS; never sent out. */
  boards?: Record<string, BoardPreferences & { touchedAt: number }>;
  wallybot?: { autoApply?: boolean };
};

export type WhiteboardDoc = {
  revision?: number;
  /**
   * Set by board.delete. From that moment the board reads as absent for everyone — read it
   * through liveWhiteboard(), never withId(), except in the cleanup job that finishes it.
   */
  deletedAt?: Timestamp;
  name: string;
  ownerId: string;
  /**
   * uid -> role for ACTIVE members only. A read cache for getEffectiveRole, which runs on
   * nearly every request: without it, resolving a caller's role costs a second query on
   * top of the board read. The `members` subcollection stays the source of truth, and
   * every write that touches a membership must update both in ONE transaction — see
   * lib/members.ts.
   */
  memberRoles: Record<string, WhiteboardRole>;
  /** Mirrors the id of this board's shareLinks document, so the lookup is one read. */
  shareLinkToken: string | null;
  /**
   * Set by board.assistant. Absent or false means the deployment switch alone decides, so
   * every board that existed before the assistant stays enabled with it.
   */
  assistantDisabled?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type MemberDoc = {
  /** Denormalized from the parent path so collection-group query results carry it. */
  whiteboardId: string;
  userId: string | null;
  /** Always stored lowercase — Firestore has no case-insensitive matching. */
  invitedEmail: string | null;
  role: WhiteboardRole;
  status: MembershipStatus;
  invitedAt: Timestamp;
  activatedAt: Timestamp | null;
};

export type NoteDoc = {
  revision?: number;
  deletedAt?: Timestamp;
  whiteboardId: string;
  title: string;
  /** Missing on notes written before descriptions existed; read it as `''`. */
  description?: string;
  status: NoteStatus;
  completedAt: Timestamp | null;
  priority: NotePriority;
  horizon: NoteHorizon;
  freeX: number;
  freeY: number;
  /** Date-only 'YYYY-MM-DD'; a string sorts chronologically and carries no timezone. */
  dueDate: string | null;
  assigneeId: string | null;
  tags: string[];
  /** Free-form key/value properties. See packages/shared's customFieldsSchema. */
  customFields: Record<string, string>;
  colour: NoteColour;
  /** Missing on notes written before private notes existed; read it as `'SHARED'`.
   *  Invariant: `'PRIVATE'` implies `createdById !== null && assigneeId === createdById`. */
  visibility?: NoteVisibility;
  createdById: string | null;
  /**
   * Denormalized count of this note's subtasks. NoteDto carries it for every note in a
   * list, which would otherwise be a subcollection read per note. Maintained by the
   * subtask routes in the same transaction as the subtask write.
   */
  subtaskSummary: { total: number; done: number };
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type SubtaskDoc = {
  noteId: string;
  text: string;
  done: boolean;
  sortIndex: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type HistoryEventDoc = {
  noteId: string;
  type: NoteHistoryEventType;
  occurredAt: Timestamp;
  actorId: string | null;
  metadata: Record<string, unknown> | null;
};

export type ShareLinkDoc = {
  whiteboardId: string;
  role: WhiteboardRole;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/** One contents-free record per command the assistant committed; the id is the operation id. */
export type AssistantAuditDoc = {
  operationId: string;
  actorId: string;
  boardId: string;
  /** The note the command targeted, or the note it created; null for board commands. */
  targetId: string | null;
  commandType: BoardCommand['type'];
  conversationId: string;
  approvalId: string;
  revision: number;
  occurredAt: Timestamp;
  expiresAt: Timestamp;
};

/** users/{uid}/assistantUsage/{YYYY-MM-DD}: the user's assistant tokens for one UTC day. */
export type AssistantUsageDoc = {
  /** Reserved worst case, replaced by the actual usage on settlement. */
  tokens: number;
  /**
   * attemptId -> startedAt millis, for the model calls in flight that were reserved on this
   * day. The per-user bound also counts the previous day's live slots (see reserveAttempt).
   */
  inFlight: Record<string, number>;
  updatedAt: Timestamp;
};

/** assistantSpend/{YYYY-MM}: the deployment key's spend for one UTC month. */
export type AssistantSpendDoc = {
  microUsd: number;
  updatedAt: Timestamp;
};

/** users/{uid}/assistantAttempts/{attemptId}: one reserved, then settled, model call. */
export type AssistantAttemptDoc = {
  day: string;
  month: string;
  reservedTokens: number;
  reservedMicroUsd: number;
  /** The price at reservation, used again at settlement; both 0 on the user's own key. */
  inputMicroUsdPerToken: number;
  outputMicroUsdPerToken: number;
  state: 'RESERVED' | 'SETTLED';
  settledTokens?: number;
  settledMicroUsd?: number;
  createdAt: Timestamp;
  settledAt?: Timestamp;
  /** createdAt + ATTEMPT_RETENTION_DAYS; the TTL field. */
  expiresAt: Timestamp;
};

/** One visible entry of an assistant conversation, as the panel shows it. */
export type AssistantEntryDoc = {
  role: 'user' | 'assistant';
  text: string;
  chips: { id: string; title: string }[];
  partial: boolean;
  stopped: 'TOOL_LIMIT' | 'TIMEOUT' | 'LENGTH' | null;
  at: Timestamp;
};

/** users/{uid}/assistantConversations/{id}: one read-only assistant conversation on a board. */
export type AssistantConversationDoc = {
  boardId: string;
  /** The provider:model the conversation is pinned to. */
  model: string;
  status: 'OPEN' | 'CLOSED';
  turns: number;
  /** The library's own messages, opaque JSON, replayed on continuation. */
  messages: unknown[];
  entries: AssistantEntryDoc[];
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
  toolCalls: number;
  createdAt: Timestamp;
  lastTurnAt: Timestamp;
  /** lastTurnAt + CONVERSATION_RETENTION_DAYS; the TTL field. */
  expiresAt: Timestamp;
};

/**
 * One operation id per write and per direction, minted when the suggestion is created. The
 * subtask ids are indexed like the proposed items; records from slice 2 carry only the first
 * three keys and read as proposing nothing else.
 */
export type SuggestionOperationIds = {
  dueDate: { apply: string; undo: string };
  priority: { apply: string; undo: string };
  assignee: { apply: string; undo: string };
  title?: { apply: string; undo: string };
  reference?: { apply: string; undo: string };
  subtasks?: { apply: string; undo: string }[];
};

/**
 * users/{uid}/assistantSuggestions/{id}: the approval record for one capture
 * (WALLY_AGENT.md §3.2, WALLYBOT_INLINE.md §4). The id doubles as the provenance's
 * conversation and approval id, since a capture turn has no conversation (plan R2).
 */
export type AssistantSuggestionDoc = {
  boardId: string;
  noteId: string;
  /** The note revision the proposal was computed against. */
  baseRevision: number;
  /**
   * The note's title at `baseRevision`, stored with a proposed title: what an undo of a kept
   * title puts back, even when the keep resumes on a note that already holds the new one.
   */
  baseTitle?: string;
  fields: {
    dueDate: { value: string; reason: string } | null;
    priority: { value: 'HOCH' | 'NIEDRIG'; reason: string } | null;
    /** A user id; the DTO resolves it to a summary at read time. */
    assignee: { value: string; reason: string } | null;
    title?: { value: string; reason: string } | null;
    reference?: { key: string; value: string; reason: string } | null;
    subtasks?: { items: string[]; reason: string } | null;
  };
  /** The fields the person decided while writing (`locked` at capture); absent on slice 2 records. */
  typed?: SuggestionFieldKey[];
  operationIds: SuggestionOperationIds;
  status: 'PENDING' | 'KEPT' | 'UNDONE' | 'DISCARDED';
  decision: {
    source: string;
    fields: SuggestionFieldKey[];
    /** For a keep with subtasks: the indexes of the items the person kept. */
    subtasks?: number[];
    at: Timestamp;
  } | null;
  /**
   * Written by an undo, beside the keep's `decision`, which stays as the keep recorded it.
   * Optional: records written before this field existed have none.
   */
  undone?: { source: string; at: Timestamp } | null;
  /** Written by a keep: what the note held before, and the revision the keep produced. */
  applied: {
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
    revision: number;
  } | null;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  /** createdAt + SUGGESTION_RETENTION_DAYS; the TTL field. */
  expiresAt: Timestamp;
};
