import type { NoteDto, SuggestionFieldKey } from '@wally/shared';
import { isMutationPending, whenSettled } from '@/lib/mutationQueue';

/**
 * What an edit's ask leaves alone (the smarter-capture spec, revision "editing the text asks
 * again"): the words the person just wrote, and the horizon, proposed for a fresh note only.
 */
export const EDIT_LOCKED: readonly SuggestionFieldKey[] = ['title', 'description', 'horizon'];

/**
 * An edit asks again only where a capture could: the person's own note (the server answers
 * anyone else's with 404), still open, on a board with its assistant on.
 */
export function editAskAllowed(
  note: Pick<NoteDto, 'status' | 'createdBy'>,
  userId: string | undefined,
  enabled: boolean,
): boolean {
  return enabled && userId !== undefined && note.status === 'OPEN' && note.createdBy?.id === userId;
}

export interface NoteText {
  title: string;
  description: string;
}

/** Whether the words changed; spaces around them are not a change. */
export function textChanged(before: NoteText, after: NoteText): boolean {
  return (
    before.title.trim() !== after.title.trim() ||
    before.description.trim() !== after.description.trim()
  );
}

/**
 * Resolves once the note's writes have all reached the server, those still to be queued by a
 * field flushed on blur included (its save starts a moment later), so an edit's ask reads the
 * words the person finished with.
 */
export async function afterNoteSaves(noteId: string): Promise<void> {
  const resource = `note:${noteId}`;
  do {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await whenSettled(resource);
  } while (isMutationPending(resource));
}
