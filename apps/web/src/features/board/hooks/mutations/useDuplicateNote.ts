import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FREE_CANVAS_HEIGHT,
  FREE_CANVAS_WIDTH,
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  type NoteDto,
  type NoteDuplicateInput,
} from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { toast } from '@/lib/toast';
import { useQueryKeys } from '../queryKeys';

const TEMP_ID_PREFIX = 'temp-';

/** How far a copy sits from its source on the free canvas, so it fans out instead of
 * landing exactly on top and looking like nothing happened. */
const COPY_OFFSET = 24;

/** Where the copy goes. Omitted fields keep the source's value. */
export type DuplicatePlacement = Pick<
  NoteDuplicateInput,
  'horizon' | 'priority' | 'freeX' | 'freeY'
>;

interface DuplicateVariables {
  noteId: string;
  input: NoteDuplicateInput;
}

function clamp(value: number, max: number) {
  return Math.max(0, Math.min(max, value));
}

function nudged(source: NoteDto): DuplicatePlacement {
  return {
    freeX: clamp(source.freeX + COPY_OFFSET, FREE_CANVAS_WIDTH - NOTE_CARD_WIDTH),
    freeY: clamp(source.freeY + COPY_OFFSET, FREE_CANVAS_HEIGHT - NOTE_CARD_HEIGHT),
  };
}

function optimisticCopy(source: NoteDto, tempId: string, input: NoteDuplicateInput): NoteDto {
  const now = new Date().toISOString();
  return {
    ...source,
    ...input,
    id: tempId,
    status: 'OPEN',
    completedAt: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Copies a note whole — fields, subtasks and their ticks — as a new open note.
 *
 * The copy shows on the board at once and the server's answer replaces it. A toast then
 * offers Undo, which deletes the copy outright: unlike a delete, there is nothing on the
 * board worth holding back for.
 *
 * `onUndo` lets the caller close the panel if the copy it opened is taken away again.
 */
export function useDuplicateNote(
  boardId: string,
  { onUndo }: { onUndo?: (id: string) => void } = {},
) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const notesKey = keys.notes(boardId);

  const { mutate, isPending } = useMutation({
    mutationFn: ({ noteId, input }: DuplicateVariables) => notesApi.duplicate(noteId, input),
    onMutate: async ({ noteId, input }) => {
      await queryClient.cancelQueries({ queryKey: notesKey });
      const previous = queryClient.getQueryData<NoteDto[]>(notesKey);
      const source = previous?.find((n) => n.id === noteId);
      const tempId = `${TEMP_ID_PREFIX}${Date.now()}`;
      if (source) {
        queryClient.setQueryData<NoteDto[]>(notesKey, (prev) => [
          ...(prev ?? []),
          optimisticCopy(source, tempId, input),
        ]);
      }
      return { previous, tempId };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(notesKey, context.previous);
    },
    onSuccess: (created, _vars, context) => {
      queryClient.setQueryData<NoteDto[]>(notesKey, (prev) =>
        prev?.map((n) => (n.id === context?.tempId ? created : n)),
      );
      toast({
        title: created.title ? 'toast.noteDuplicated' : 'toast.noteDuplicatedUntitled',
        values: { title: created.title },
        action: {
          label: 'toast.undo',
          onClick: () => {
            queryClient.setQueryData<NoteDto[]>(notesKey, (prev) =>
              prev?.filter((n) => n.id !== created.id),
            );
            // The copy's detail query is left to expire on its own. Removing it here, while
            // the panel showing the copy is still mounted, made that panel refetch a note
            // that was about to be deleted.
            onUndo?.(created.id);
            void notesApi
              .remove(created.id)
              .finally(() => void queryClient.invalidateQueries({ queryKey: notesKey }));
          },
        },
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notesKey });
    },
  });

  /**
   * Title and description are taken from the cache rather than left to the server: the
   * panel saves both on a debounce but patches the cache on every keystroke, so this is the
   * only place the last half second of typing is guaranteed to be.
   */
  const duplicate = useCallback(
    (
      noteId: string,
      placement?: DuplicatePlacement,
      options?: { onSuccess?: (created: NoteDto) => void },
    ) => {
      const source = queryClient.getQueryData<NoteDto[]>(notesKey)?.find((n) => n.id === noteId);
      // A note that is still being created has no server id to copy from yet.
      if (!source || source.id.startsWith(TEMP_ID_PREFIX)) return;
      mutate(
        {
          noteId,
          input: {
            title: source.title,
            description: source.description,
            // Nudged even when dropped into a zone, so the copy is not stacked exactly on
            // its source once the board is switched to the free canvas.
            ...nudged(source),
            ...placement,
          },
        },
        { onSuccess: options?.onSuccess },
      );
    },
    [mutate, notesKey, queryClient],
  );

  return { duplicate, isPending };
}
