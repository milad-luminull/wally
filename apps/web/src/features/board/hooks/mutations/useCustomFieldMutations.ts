import { useMutation, useQueryClient } from '@tanstack/react-query';
import { findFieldKey, type CustomFields, type NoteDto } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { queryKeys } from '../queryKeys';
import {
  cancelNoteCaches,
  patchNoteCaches,
  restoreNoteCaches,
  settleNoteCaches,
  snapshotNoteCaches,
} from './shared';

/** Like tags, there is no dedicated per-property route — PATCH /notes/:id replaces the
 * whole `customFields` map, so both hooks read the current cached map and send the next
 * one. See packages/shared/src/schemas/note.ts. */
function currentFields(
  queryClient: ReturnType<typeof useQueryClient>,
  boardId: string,
  noteId: string,
): CustomFields {
  const list = queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId));
  return list?.find((n) => n.id === noteId)?.customFields ?? {};
}

/** Adds or overwrites one property. Matching an existing key case-insensitively keeps
 * "Kunde" and "kunde" from becoming two rows that shadow each other. */
function withField(fields: CustomFields, key: string, value: string): CustomFields {
  const existing = findFieldKey(fields, key);
  return { ...fields, [existing ?? key]: value };
}

function withoutField(fields: CustomFields, key: string): CustomFields {
  const { [key]: _removed, ...rest } = fields;
  return rest;
}

export function useSetCustomField(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, key, value }: { noteId: string; key: string; value: string }) => {
      const next = withField(currentFields(queryClient, boardId, noteId), key, value);
      return notesApi.update(noteId, { customFields: next });
    },
    onMutate: ({ noteId, key, value }) => {
      cancelNoteCaches(queryClient, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, boardId, noteId);
      const next = withField(currentFields(queryClient, boardId, noteId), key, value);
      patchNoteCaches(queryClient, boardId, noteId, { customFields: next });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, boardId, noteId, snapshot);
    },
    onSettled: (_d, _e, { noteId }) => settleNoteCaches(queryClient, boardId, noteId),
  });
}

export function useRemoveCustomField(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, key }: { noteId: string; key: string }) => {
      const next = withoutField(currentFields(queryClient, boardId, noteId), key);
      return notesApi.update(noteId, { customFields: next });
    },
    onMutate: ({ noteId, key }) => {
      cancelNoteCaches(queryClient, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, boardId, noteId);
      const next = withoutField(currentFields(queryClient, boardId, noteId), key);
      patchNoteCaches(queryClient, boardId, noteId, { customFields: next });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, boardId, noteId, snapshot);
    },
    onSettled: (_d, _e, { noteId }) => settleNoteCaches(queryClient, boardId, noteId),
  });
}
