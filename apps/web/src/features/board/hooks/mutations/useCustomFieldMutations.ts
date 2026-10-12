import { useQueryClient } from '@tanstack/react-query';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import { findFieldKey, type CustomFields, type NoteDto } from '@wally/shared';
import { notesApi } from '@/lib/resources';
import { useQueryKeys, type QueryKeys } from '../queryKeys';
import {
  captureNoteMutation,
  cancelNoteCaches,
  patchNoteCaches,
  restoreNoteCaches,
  settleNoteCaches,
  snapshotNoteCaches,
} from './shared';

/** The request carries only the one property being changed (`fieldChanges`), which the API
 * merges into the note's stored map — sending the whole cached map would drop a property a
 * colleague added meanwhile. The cached map is used only for the optimistic patch. See
 * packages/shared/src/schemas/note.ts. */
function currentFields(
  queryClient: ReturnType<typeof useQueryClient>,
  keys: QueryKeys,
  boardId: string,
  noteId: string,
): CustomFields {
  const list = queryClient.getQueryData<NoteDto[]>(keys.notes(boardId));
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
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({ noteId, key, value }: { noteId: string; key: string; value: string }) =>
      notesApi.update(
        noteId,
        { fieldChanges: { set: { [key]: value } } },
        captureNoteMutation(queryClient, keys, boardId, noteId),
      ),
    onMutate: ({ noteId, key, value }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, keys, boardId, noteId);
      const next = withField(currentFields(queryClient, keys, boardId, noteId), key, value);
      patchNoteCaches(queryClient, keys, boardId, noteId, { customFields: next });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
    },
    onSettled: (_d, _e, { noteId }) => settleNoteCaches(queryClient, keys, boardId, noteId),
  });
}

export function useRemoveCustomField(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  return useMutation({
    mutationFn: ({ noteId, key }: { noteId: string; key: string }) =>
      notesApi.update(
        noteId,
        { fieldChanges: { remove: [key] } },
        captureNoteMutation(queryClient, keys, boardId, noteId),
      ),
    onMutate: ({ noteId, key }) => {
      cancelNoteCaches(queryClient, keys, boardId, noteId);
      const snapshot = snapshotNoteCaches(queryClient, keys, boardId, noteId);
      const next = withoutField(currentFields(queryClient, keys, boardId, noteId), key);
      patchNoteCaches(queryClient, keys, boardId, noteId, { customFields: next });
      return snapshot;
    },
    onError: (_err, { noteId }, snapshot) => {
      if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
    },
    onSettled: (_d, _e, { noteId }) => settleNoteCaches(queryClient, keys, boardId, noteId),
  });
}
