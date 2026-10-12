import type {
  EffectiveRole,
  HistoryEventDto,
  Language,
  MeDto,
  MemberDto,
  NoteDetailDto,
  NoteDto,
  Preferences,
  ShareLinkDto,
  SubtaskDto,
  SubtaskSummary,
  UserSummary,
  WhiteboardDto,
} from '@wally/shared';
import type {
  HistoryEventDoc,
  MemberDoc,
  NoteDoc,
  ShareLinkDoc,
  SubtaskDoc,
  UserDoc,
  WhiteboardDoc,
  WithId,
} from './db/types.js';
import { toIso, toIsoOrNull } from './db/collections.js';

/** Users referenced by the documents being mapped, keyed by id — see loadUsers. */
export type UserMap = Map<string, WithId<UserDoc>>;

export function toUserSummary(user: WithId<UserDoc> | null | undefined): UserSummary | null {
  if (!user) return null;
  return { id: user.id, email: user.email, displayName: user.displayName };
}

/**
 * The caller's own profile.
 *
 * Takes its fields structurally rather than a WithId<UserDoc> so both call sites can use it
 * without a redundant read: GET /me maps the already decorated `request.user` (the auth
 * preHandler read that document a moment ago) and PATCH /me maps the state it has just
 * written. Structural rather than `AuthenticatedUser` on purpose — lib/ importing a type out
 * of plugins/ would invert the layering, since plugins/ already imports lib/.
 *
 * Note a raw WithId<UserDoc> does NOT satisfy this at runtime: `language` may be absent. That
 * is the point — callers must pass a value that has been through userLanguage().
 */
export function toMeDto(user: {
  id: string;
  email: string;
  displayName: string | null;
  language: Language;
  preferences: Preferences;
}): MeDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    language: user.language,
    preferences: user.preferences,
  };
}

function lookup(users: UserMap, id: string | null): UserSummary | null {
  return id ? toUserSummary(users.get(id)) : null;
}

export function toSubtaskDto(subtask: WithId<SubtaskDoc>): SubtaskDto {
  return {
    id: subtask.id,
    noteId: subtask.noteId,
    text: subtask.text,
    done: subtask.done,
    sortIndex: subtask.sortIndex,
    createdAt: toIso(subtask.createdAt),
    updatedAt: toIso(subtask.updatedAt),
  };
}

export function toSubtaskSummary(subtasks: WithId<SubtaskDoc>[]): SubtaskSummary {
  return {
    total: subtasks.length,
    done: subtasks.filter((s) => s.done).length,
  };
}

export function toHistoryEventDto(event: WithId<HistoryEventDoc>, users: UserMap): HistoryEventDto {
  return {
    id: event.id,
    type: event.type,
    occurredAt: toIso(event.occurredAt),
    actor: lookup(users, event.actorId),
    metadata: event.metadata,
  };
}

export function toNoteDto(note: WithId<NoteDoc>, users: UserMap): NoteDto {
  return {
    id: note.id,
    whiteboardId: note.whiteboardId,
    revision: note.revision ?? 0,
    title: note.title,
    description: note.description ?? '',
    status: note.status,
    completedAt: toIsoOrNull(note.completedAt),
    priority: note.priority,
    horizon: note.horizon,
    freeX: note.freeX,
    freeY: note.freeY,
    dueDate: note.dueDate,
    assignee: lookup(users, note.assigneeId),
    // Notes written before custom fields existed have no such field at all, and the
    // 200-response schema requires an object.
    customFields: note.customFields ?? {},
    tags: note.tags,
    colour: note.colour,
    subtaskSummary: note.subtaskSummary,
    createdBy: lookup(users, note.createdById),
    createdAt: toIso(note.createdAt),
    updatedAt: toIso(note.updatedAt),
  };
}

/**
 * The detail view has the real subtasks in hand, so it recomputes the summary rather than
 * trusting the denormalized counter on the note — which quietly repairs any drift.
 */
export function toNoteDetailDto(
  note: WithId<NoteDoc>,
  subtasks: WithId<SubtaskDoc>[],
  history: WithId<HistoryEventDoc>[],
  users: UserMap,
): NoteDetailDto {
  return {
    ...toNoteDto(note, users),
    subtaskSummary: toSubtaskSummary(subtasks),
    subtasks: [...subtasks].sort((a, b) => a.sortIndex - b.sortIndex).map(toSubtaskDto),
    history: [...history]
      .sort((a, b) => b.occurredAt.toMillis() - a.occurredAt.toMillis())
      .map((event) => toHistoryEventDto(event, users)),
  };
}

export function toWhiteboardDto(
  whiteboard: WithId<WhiteboardDoc>,
  currentUserRole: EffectiveRole,
): WhiteboardDto {
  return {
    id: whiteboard.id,
    name: whiteboard.name,
    ownerId: whiteboard.ownerId,
    revision: whiteboard.revision ?? 0,
    currentUserRole,
    createdAt: toIso(whiteboard.createdAt),
    updatedAt: toIso(whiteboard.updatedAt),
  };
}

export function toMemberDto(member: WithId<MemberDoc>, users: UserMap): MemberDto {
  const user = member.userId ? users.get(member.userId) : undefined;
  const email = user?.email ?? member.invitedEmail;
  if (!email) {
    // Every membership is written with either a linked user or an invitedEmail.
    throw new Error(`Member ${member.id} has neither user nor invitedEmail`);
  }
  return {
    id: member.id,
    userId: member.userId,
    email,
    displayName: user?.displayName ?? null,
    role: member.role,
    status: member.status,
  };
}

/**
 * The board owner as a member row. No such document exists — a board records its owner in
 * `ownerId`, and an invite addressed to the owner is deleted rather than stored (see
 * lib/members.ts). Without this the members list comes back empty on a board nobody has been
 * invited to, which is every personal board: the assignee picker then offers "Niemand" and
 * nothing else, so a note could never be assigned, not even to yourself.
 *
 * The `owner:` prefix cannot collide with a Firestore auto-id, so the member PATCH/DELETE
 * routes 404 on it without needing a guard of their own.
 */
export function ownerMemberDto(board: WithId<WhiteboardDoc>, users: UserMap): MemberDto {
  const user = users.get(board.ownerId);
  if (!user) {
    throw new Error(`Whiteboard ${board.id} has no user record for owner ${board.ownerId}`);
  }
  return {
    id: `owner:${board.ownerId}`,
    userId: board.ownerId,
    email: user.email,
    displayName: user.displayName,
    role: 'OWNER',
    status: 'ACTIVE',
  };
}

export function toShareLinkDto(shareLink: WithId<ShareLinkDoc>, baseUrl: string): ShareLinkDto {
  return {
    token: shareLink.id,
    role: shareLink.role,
    url: `${baseUrl.replace(/\/$/, '')}/share/${shareLink.id}`,
  };
}
