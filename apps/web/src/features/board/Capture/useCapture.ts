import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NoteCreateInput, NoteDto, NoteVisibility, SuggestionFieldKey } from '@wally/shared';
import type { MutationTicket } from '@/lib/mutationQueue';
import { notesApi } from '@/lib/resources';
import { useSessionMutation } from '@/lib/useSessionMutation';
import { useAssignNote } from '../hooks/mutations/useAssignNote';
import { useCreateNote } from '../hooks/mutations/useCreateNote';
import { useMoveNote } from '../hooks/mutations/useMoveNote';
import { useUpdateNote } from '../hooks/mutations/useUpdateNote';
import { captureNoteMutation } from '../hooks/mutations/shared';
import { useQueryKeys } from '../hooks/queryKeys';
import { nextFreeNotePosition } from '../util/notePlacement';

export type CapturePlacement =
  | { kind: 'free'; x: number; y: number }
  | {
      kind: 'zone';
      axis: 'horizon' | 'priority';
      key: string;
      at: { freeX: number; freeY: number };
      /** The person chose this zone (a click in it), rather than the New note button's default. */
      picked?: boolean;
    }
  | { kind: 'list' };

/**
 * How a question left the capture card: `takeFocus` is true only for Enter. A question settled
 * by a blur (a click or Tab elsewhere) leaves the focus where the person put it (plan R8).
 */
export interface AskOptions {
  takeFocus: boolean;
}

/** Hears a question typed into the capture card (RFC-0005-wallybot-inline.md §3.6). */
export type CaptureAsk = (question: string, options: AskOptions) => void;

export interface CaptureFields {
  dueDate: string | null;
  assigneeId: string | null;
  priority: 'HOCH' | 'NIEDRIG' | null;
}

export interface CaptureController {
  state: 'drafting' | 'creating' | 'committing';
  /** null until the first keystroke's create resolves. */
  noteId: string | null;
  /** The first keystroke in either field creates the note, with what the fields hold then. */
  onFirstKeystroke: (draft: { title: string; description: string }) => void;
  /** `locked` names the fields the person decided here; it is handed to `onDone` as it is. */
  commit: (
    draft: {
      title: string;
      description: string;
      fields: CaptureFields;
      locked: SuggestionFieldKey[];
    },
    thenOpen: boolean,
  ) => Promise<void>;
  /** Deletes the note if one was created. */
  cancel: () => Promise<void>;
  /**
   * Saves the words typed so far to the note, debounced, so a reload or a crash mid-capture
   * keeps the line (RFC-0005-wallybot-inline.md §3.1). Title and text only: kept chips still apply on
   * commit alone. Does nothing until the first keystroke has started the create, nor for two
   * fields erased to nothing.
   */
  saveDraft: (draft: { title: string; description: string }) => void;
}

/** How long typing must pause before the words so far are saved. */
export const DRAFT_SAVE_MS = 500;

function placementInput(placement: CapturePlacement, notes: NoteDto[]): Partial<NoteCreateInput> {
  switch (placement.kind) {
    case 'free':
      return { freeX: placement.x, freeY: placement.y };
    case 'zone':
      return placement.axis === 'horizon'
        ? { ...nextFreeNotePosition(notes), horizon: placement.key as NoteCreateInput['horizon'] }
        : {
            ...nextFreeNotePosition(notes),
            priority: placement.key as NoteCreateInput['priority'],
          };
    case 'list':
      return nextFreeNotePosition(notes);
  }
}

/**
 * Deletes an abandoned capture at once, without `useDeleteNote`'s Undo toast: that hook holds
 * the DELETE back until its toast expires, and the person has just said they do not want this
 * note, so there is nothing to undo. Same lane and same settle as useDeleteNote. The ticket is
 * taken with `captureNoteMutation` (the revision the cache shows) when the delete is asked for,
 * before `onMutate` drops the note from the cache; unlike useDeleteNote's it is not pinned,
 * since no toast holds this DELETE back.
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
 * The state machine behind the capture card (RFC-0005-wallybot-inline.md §3.1): the note exists from
 * the first keystroke, so nothing typed is lost; the commit is one update plus, for each kept
 * chip the update cannot carry, its own call (a priority is a PRIORITY move, a person an
 * assignment); cancelling after typing deletes the note the person chose to abandon. Every
 * write goes through the existing optimistic hooks and the mutation lane.
 */
export function useCapture(
  boardId: string,
  placement: CapturePlacement,
  visibility: NoteVisibility,
  callbacks: {
    /** `locked` is the fields the person decided while writing; `[]` on cancel. */
    onDone: (noteId: string | null, open: boolean, locked: SuggestionFieldKey[]) => void;
    /** Hears each id the note is shown under (temp, then real), before the board shows it. */
    onNoteId?: (id: string) => void;
  },
): CaptureController {
  const { onDone, onNoteId } = callbacks;
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const { mutateAsync: createNote } = useCreateNote(boardId, { onNoteId });
  const { mutateAsync: updateNote } = useUpdateNote(boardId);
  const { mutateAsync: moveNote } = useMoveNote(boardId);
  const { mutateAsync: assignNote } = useAssignNote(boardId);
  const removeNote = useRemoveCapturedNote(boardId);
  const [state, setState] = useState<CaptureController['state']>('drafting');
  const [noteId, setNoteId] = useState<string | null>(null);
  // The create's promise, so a commit or cancel that lands before the id is known can wait.
  const creation = useRef<Promise<NoteDto> | null>(null);
  // The draft waiting for typing to pause, and the last one written (or created with).
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<{ title: string; description: string } | null>(null);
  const savedDraft = useRef<{ title: string; description: string } | null>(null);

  const startCreation = useCallback(
    (draft: { title: string; description: string }) => {
      setState('creating');
      // Read the full cache at creation time: view filters and a stale capture position
      // must not reserve the same free-wall slot as another note.
      const notes = queryClient.getQueryData<NoteDto[]>(keys.notes(boardId)) ?? [];
      const pending = createNote({ ...placementInput(placement, notes), ...draft, visibility });
      creation.current = pending;
      savedDraft.current = draft;
      // Only the create's own state is reset: a commit (or its retry) started meanwhile owns
      // the state until it settles, and the field stays read-only for all of it.
      const createSettled = (s: CaptureController['state']) => (s === 'creating' ? 'drafting' : s);
      pending.then(
        (note) => {
          setNoteId(note.id);
          setState(createSettled);
        },
        () => {
          // A failed create may be retried by the commit; the global handler says why.
          if (creation.current === pending) creation.current = null;
          setState(createSettled);
        },
      );
      return pending;
    },
    [boardId, createNote, keys, placement, queryClient, visibility],
  );

  const onFirstKeystroke = useCallback<CaptureController['onFirstKeystroke']>(
    (draft) => {
      if (!creation.current) void startCreation(draft);
    },
    [startCreation],
  );

  const clearDraft = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    pendingDraft.current = null;
  }, []);

  const writeDraft = useCallback(async () => {
    const draft = pendingDraft.current;
    clearDraft();
    const pending = creation.current;
    if (!draft || !pending) return;
    const saved = savedDraft.current;
    if (saved && saved.title === draft.title && saved.description === draft.description) return;
    savedDraft.current = draft;
    try {
      const { id } = await pending;
      // Through the same lane as the commit, so the commit's update always lands after it.
      await updateNote({ noteId: id, input: draft });
    } catch {
      // The commit writes the same words again; the global handler reports the failure.
      savedDraft.current = null;
    }
  }, [clearDraft, updateNote]);

  const saveDraft = useCallback<CaptureController['saveDraft']>(
    (draft) => {
      if (!creation.current) return;
      // Both fields erased to nothing are not a line worth keeping; drop what was waiting.
      clearDraft();
      if (!draft.title && !draft.description) return;
      pendingDraft.current = draft;
      draftTimer.current = setTimeout(() => void writeDraft(), DRAFT_SAVE_MS);
    },
    [clearDraft, writeDraft],
  );

  // A card taken away mid-typing (not committed, not cancelled) still keeps its words.
  const flushOnUnmount = useRef(writeDraft);
  flushOnUnmount.current = writeDraft;
  useEffect(() => () => void flushOnUnmount.current(), []);

  const commit = useCallback<CaptureController['commit']>(
    async ({ title, description, fields, locked }, thenOpen) => {
      clearDraft();
      // A create started here (the first one failed) is part of the commit: committing wins.
      const pending = creation.current ?? startCreation({ title, description });
      setState('committing');
      try {
        const { id } = await pending;
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
        onDone(id, thenOpen, locked);
      } finally {
        setState('drafting');
      }
    },
    [assignNote, clearDraft, moveNote, onDone, startCreation, updateNote],
  );

  const cancel = useCallback(async () => {
    clearDraft();
    const note = creation.current ? await creation.current.catch(() => null) : null;
    if (note) removeNote(note.id);
    onDone(null, false, []);
  }, [clearDraft, onDone, removeNote]);

  return { state, noteId, onFirstKeystroke, commit, cancel, saveDraft };
}
