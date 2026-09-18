import type {
  Note,
  NoteHistoryEvent,
  ReferenceOption,
  ShareLink,
  Subtask,
  User,
  Whiteboard,
  WhiteboardMember,
} from './prisma-client.js';
import type {
  EffectiveRole,
  HistoryEventDto,
  MemberDto,
  NoteDetailDto,
  NoteDto,
  ReferenceOptionDto,
  ShareLinkDto,
  SubtaskDto,
  SubtaskSummary,
  UserSummary,
  WhiteboardDto,
} from '@wally/shared';

export function toUserSummary(user: User | null): UserSummary | null {
  if (!user) return null;
  return { id: user.id, email: user.email, displayName: user.displayName };
}

/** DB stores dueDate as a plain DATE column; format it back to YYYY-MM-DD (no timezone). */
export function toDateOnly(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

export function toSubtaskDto(subtask: Subtask): SubtaskDto {
  return {
    id: subtask.id,
    noteId: subtask.noteId,
    text: subtask.text,
    done: subtask.done,
    sortIndex: subtask.sortIndex,
    createdAt: subtask.createdAt.toISOString(),
    updatedAt: subtask.updatedAt.toISOString(),
  };
}

export function toSubtaskSummary(subtasks: Subtask[]): SubtaskSummary {
  return {
    total: subtasks.length,
    done: subtasks.filter((s) => s.done).length,
  };
}

export function toHistoryEventDto(
  event: NoteHistoryEvent & { actor: User | null },
): HistoryEventDto {
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    actor: toUserSummary(event.actor),
    metadata: (event.metadata as Record<string, unknown> | null) ?? null,
  };
}

type NoteWithRelations = Note & {
  assignee: User | null;
  createdBy: User | null;
  subtasks: Subtask[];
};

export function toNoteDto(note: NoteWithRelations): NoteDto {
  return {
    id: note.id,
    whiteboardId: note.whiteboardId,
    title: note.title,
    status: note.status,
    completedAt: note.completedAt ? note.completedAt.toISOString() : null,
    priority: note.priority,
    horizon: note.horizon,
    freeX: note.freeX,
    freeY: note.freeY,
    dueDate: toDateOnly(note.dueDate),
    assignee: toUserSummary(note.assignee),
    referenceType: note.referenceType,
    referenceLabel: note.referenceLabel,
    tags: note.tags,
    colour: note.colour,
    subtaskSummary: toSubtaskSummary(note.subtasks),
    createdBy: toUserSummary(note.createdBy),
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

type NoteDetailWithRelations = NoteWithRelations & {
  history: (NoteHistoryEvent & { actor: User | null })[];
};

export function toNoteDetailDto(note: NoteDetailWithRelations): NoteDetailDto {
  return {
    ...toNoteDto(note),
    subtasks: [...note.subtasks]
      .sort((a, b) => a.sortIndex - b.sortIndex)
      .map(toSubtaskDto),
    history: [...note.history]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .map(toHistoryEventDto),
  };
}

export function toWhiteboardDto(whiteboard: Whiteboard, currentUserRole: EffectiveRole): WhiteboardDto {
  return {
    id: whiteboard.id,
    name: whiteboard.name,
    ownerId: whiteboard.ownerId,
    currentUserRole,
    createdAt: whiteboard.createdAt.toISOString(),
    updatedAt: whiteboard.updatedAt.toISOString(),
  };
}

export function toMemberDto(member: WhiteboardMember & { user: User | null }): MemberDto {
  const email = member.user?.email ?? member.invitedEmail;
  if (!email) {
    // Schema guarantees every member row has either a linked user or an invitedEmail.
    throw new Error(`WhiteboardMember ${member.id} has neither user nor invitedEmail`);
  }
  return {
    id: member.id,
    userId: member.userId,
    email,
    displayName: member.user?.displayName ?? null,
    role: member.role,
    status: member.status,
  };
}

export function toShareLinkDto(shareLink: ShareLink, baseUrl: string): ShareLinkDto {
  return {
    token: shareLink.token,
    role: shareLink.role,
    url: `${baseUrl.replace(/\/$/, '')}/share/${shareLink.token}`,
  };
}

export function toReferenceOptionDto(option: ReferenceOption): ReferenceOptionDto {
  return { id: option.id, type: option.type, label: option.label };
}
