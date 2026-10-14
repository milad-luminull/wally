import type { BoardVisibilityFilter, EffectiveRole, NoteDto, NoteVisibility } from '@wally/shared';

/** SPEC §9: only VIEW is read-only — OWNER and EDIT can both modify notes. */
export function canEdit(role: EffectiveRole | undefined): boolean {
  return role === 'OWNER' || role === 'EDIT';
}

export function isOwner(role: EffectiveRole | undefined): boolean {
  return role === 'OWNER';
}

type NoteAccessFields = Pick<NoteDto, 'visibility' | 'createdBy'>;

export interface BoardAccess {
  /** OWNER or EDIT: may change shared notes and decide who sees a note. */
  canEditShared: boolean;
  /** What a note created from the board right now becomes. Viewers can only add private
   *  notes, and with "Only private" on a new note must not vanish from the view. */
  newNoteVisibility: NoteVisibility;
  canEditNote(note: NoteAccessFields): boolean;
  /** Whether the panel offers the Private switch. Shown disabled to a viewer on their own
   *  private note, so it can say why it cannot be shared. */
  showsVisibilitySwitch(note: NoteAccessFields): boolean;
}

function isOwnPrivate(note: NoteAccessFields, userId: string | undefined): boolean {
  return note.visibility === 'PRIVATE' && userId !== undefined && note.createdBy?.id === userId;
}

export function boardAccess(
  role: EffectiveRole | undefined,
  userId: string | undefined,
  filter: BoardVisibilityFilter,
): BoardAccess {
  const canEditShared = canEdit(role);
  return {
    canEditShared,
    newNoteVisibility: !canEditShared || filter === 'private' ? 'PRIVATE' : 'SHARED',
    canEditNote: (note) => canEditShared || isOwnPrivate(note, userId),
    showsVisibilitySwitch: (note) =>
      userId !== undefined &&
      note.createdBy?.id === userId &&
      (canEditShared || note.visibility === 'PRIVATE'),
  };
}
