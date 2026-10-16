import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NoteCreateInput, NoteDto, NoteVisibility } from '@wally/shared';
import type { MutationTicket } from '@/lib/mutationQueue';
import { notesApi } from '@/lib/resources';
import { useSessionMutation } from '@/lib/useSessionMutation';
import { useAssignNote } from '../hooks/mutations/useAssignNote';
import { useCreateNote } from '../hooks/mutations/useCreateNote';
import { useMoveNote } from '../hooks/mutations/useMoveNote';
import { useUpdateNote } from '../hooks/mutations/useUpdateNote';
import { captureNoteMutation } from '../hooks/mutations/shared';
import { useQueryKeys } from '../hooks/queryKeys';

export type CapturePlacement =
  | { kind: 'free'; x: number; y: number }
  | {
      kind: 'zone';
      axis: 'horizon' | 'priority';
      key: string;
      at: { freeX: number; freeY: number };
    }
  | { kind: 'list' };

export interface CaptureFields {
  dueDate: string | null;
  assigneeId: string | null;
  priority: 'HOCH' | 'NIEDRIG' | null;
}

export interface CaptureController {
  state: 'drafting' | 'creating' | 'committing';
  /** null until the first keystroke's create resolves. */
  noteId: string | null;
  onFirstKeystroke: (title: string) => void;
  commit: (
    draft: { title: string; description: string; fields: CaptureFields },
    thenOpen: boolean,
  ) => Promise<void>;
  /** Deletes the note if one was created. */
  cancel: () => Promise<void>;
}

function placementInput(placement: CapturePlacement): Partial<NoteCreateInput> {
  switch (placement.kind) {
    case 'free':
      return { freeX: placement.x, freeY: placement.y };
    case 'zone':
      return placement.axis === 'horizon'
        ? { ...placement.at, horizon: placement.key as NoteCreateInput['horizon'] }
        : { ...placement.at, priority: placement.key as NoteCreateInput['priority'] };
    case 'list':
      return {};
  }
}

/**
 * Deletes an abandoned capture at once, without `useDeleteNote`'s Undo toast: that hook holds
 * the DELETE back until its toast expires, and the person has just said they do not want this
 * note, so there is nothing to undo. Same lane, same ticket rule (taken before the cache drops
 * the note, as useDeleteNote does), same settle.
 */
function useRemoveCapturedNote(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const notesKey = keys.notes(boardId);
  const { mutate } = useSessionMutation({
    mutationFn: ({ noteId, ticket }: { noteId: string; ticket: MutationTicket }) =>
      notesApi.remove(noteId, ticket),
    onMutate: ({ noteId }) => {
      void queryClient.cancelQueries({ queryKey: notesKey });
      queryClient.setQueryData<NoteDto[]>(notesKey, (prev) => prev?.filter((n) => n.id !== noteId));
    },
    onSuccess: (_data, { noteId }) =>
      queryClient.removeQueries({ queryKey: keys.noteDetail(noteId) }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: notesKey }),
  });
  return useCallback(
    (noteId: string) =>
      mutate({ noteId, ticket: captureNoteMutation(queryClient, keys, boardId, noteId) }),
    [boardId, keys, mutate, queryClient],
  );
}

/**
 * The state machine behind the capture card (WALLYBOT_INLINE.md §3.1): the note exists from
 * the first keystroke, so nothing typed is lost; the commit is one update plus, for each kept
 * chip the update cannot carry, its own call (a priority is a PRIORITY move, a person an
 * assignment); cancelling after typing deletes the note the person chose to abandon. Every
 * write goes through the existing optimistic hooks and the mutation lane.
 */
export function useCapture(
  boardId: string,
  placement: CapturePlacement,
  visibility: NoteVisibility,
  callbacks: { onDone: (noteId: string | null, open: boolean) => void },
): CaptureController {
  const { onDone } = callbacks;
  const { mutateAsync: createNote } = useCreateNote(boardId);
  const { mutateAsync: updateNote } = useUpdateNote(boardId);
  const { mutateAsync: moveNote } = useMoveNote(boardId);
  const { mutateAsync: assignNote } = useAssignNote(boardId);
  const removeNote = useRemoveCapturedNote(boardId);
  const [state, setState] = useState<CaptureController['state']>('drafting');
  const [noteId, setNoteId] = useState<string | null>(null);
  // The create's promise, so a commit or cancel that lands before the id is known can wait.
  const creation = useRef<Promise<NoteDto> | null>(null);

  const startCreation = useCallback(
    (title: string) => {
      setState('creating');
      const pending = createNote({ ...placementInput(placement), title, visibility });
      creation.current = pending;
      pending.then(
        (note) => {
          setNoteId(note.id);
          setState('drafting');
        },
        () => {
          // A failed create may be retried by the commit; the global handler says why.
          if (creation.current === pending) creation.current = null;
          setState('drafting');
        },
      );
      return pending;
    },
    [createNote, placement, visibility],
  );

  const onFirstKeystroke = useCallback(
    (title: string) => {
      if (!creation.current) void startCreation(title);
    },
    [startCreation],
  );

  const commit = useCallback<CaptureController['commit']>(
    async ({ title, description, fields }, thenOpen) => {
      setState('committing');
      try {
        const { id } = await (creation.current ?? startCreation(title));
        await updateNote({
          noteId: id,
          input: {
            title,
            description,
            ...(fields.dueDate ? { dueDate: fields.dueDate } : {}),
          },
        });
        // noteUpdateSchema carries no priority; the move endpoint owns that field alone.
        if (fields.priority)
          await moveNote({ noteId: id, input: { mode: 'PRIORITY', priority: fields.priority } });
        if (fields.assigneeId) await assignNote({ noteId: id, assigneeId: fields.assigneeId });
        onDone(id, thenOpen);
      } finally {
        setState('drafting');
      }
    },
    [assignNote, moveNote, onDone, startCreation, updateNote],
  );

  const cancel = useCallback(async () => {
    const note = creation.current ? await creation.current.catch(() => null) : null;
    if (note) removeNote(note.id);
    onDone(null, false);
  }, [onDone, removeNote]);

  return { state, noteId, onFirstKeystroke, commit, cancel };
}
