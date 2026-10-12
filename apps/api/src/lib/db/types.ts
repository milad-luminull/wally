import type { Timestamp } from 'firebase-admin/firestore';
import type {
  BoardPreferences,
  CanvasPattern,
  Language,
  MembershipStatus,
  NoteColour,
  NoteHistoryEventType,
  NoteHorizon,
  NotePriority,
  NoteStatus,
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
};

export type WhiteboardDoc = {
  revision?: number;
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
