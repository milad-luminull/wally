import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NoteDetailDto, NoteDto } from '@wally/shared';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { scopedQueryKeys } from '../queryKeys';
import { useRemoveCustomField, useSetCustomField } from './useCustomFieldMutations';

vi.mock('@/lib/resources', () => ({
  notesApi: { update: vi.fn() },
}));

// Imported after the mock so it resolves to the mocked module.
import { notesApi } from '@/lib/resources';

// Hooks rendered outside AuthProvider read and write the signed-out scope.
const queryKeys = scopedQueryKeys(null);

const boardId = 'board-1';

describe('custom field mutations', () => {
  beforeEach(() => {
    vi.mocked(notesApi.update).mockReset();
  });

  function setup(fields: Record<string, string>) {
    const note = makeNote({ customFields: fields });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.notes(boardId), [note]);
    queryClient.setQueryData(queryKeys.noteDetail(note.id), { ...note, subtasks: [], history: [] });

    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return { note, queryClient, wrapper };
  }

  const listFields = (queryClient: ReturnType<typeof createTestQueryClient>, id: string) =>
    queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId))?.find((n) => n.id === id)
      ?.customFields;

  const detailFields = (queryClient: ReturnType<typeof createTestQueryClient>, id: string) =>
    queryClient.getQueryData<NoteDetailDto>(queryKeys.noteDetail(id))?.customFields;

  it('optimistically patches both the list and detail caches when setting a property', async () => {
    const { note, queryClient, wrapper } = setup({ Kunde: 'Müller GmbH' });
    vi.mocked(notesApi.update).mockResolvedValue({
      ...note,
      customFields: { Kunde: 'Müller GmbH', Vertragsnr: '4711' },
    });

    const { result } = renderHook(() => useSetCustomField(boardId), { wrapper });
    result.current.mutate({ noteId: note.id, key: 'Vertragsnr', value: '4711' });

    await waitFor(() => {
      expect(listFields(queryClient, note.id)).toEqual({
        Kunde: 'Müller GmbH',
        Vertragsnr: '4711',
      });
      expect(detailFields(queryClient, note.id)).toEqual({
        Kunde: 'Müller GmbH',
        Vertragsnr: '4711',
      });
    });
  });

  it('sends only the changed property, and patches the stored spelling optimistically', async () => {
    const { note, queryClient, wrapper } = setup({ Kunde: 'Müller GmbH', Vertrag: 'X' });
    vi.mocked(notesApi.update).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSetCustomField(boardId), { wrapper });
    result.current.mutate({ noteId: note.id, key: 'kunde', value: 'Steiner AG' });

    // Never the whole cached map: that would drop a property a colleague added meanwhile.
    // The server resolves "kunde" to the stored "Kunde" against its current copy.
    await waitFor(() =>
      expect(notesApi.update).toHaveBeenCalledWith(note.id, {
        fieldChanges: { set: { kunde: 'Steiner AG' } },
      }),
    );
    // The stored spelling wins, so the note keeps one property rather than gaining a twin.
    expect(listFields(queryClient, note.id)).toEqual({ Kunde: 'Steiner AG', Vertrag: 'X' });
  });

  it('sends only the removed key', async () => {
    const { note, wrapper } = setup({ Kunde: 'Müller GmbH', Vertrag: 'X' });
    vi.mocked(notesApi.update).mockResolvedValue({ ...note, customFields: { Vertrag: 'X' } });

    const { result } = renderHook(() => useRemoveCustomField(boardId), { wrapper });
    result.current.mutate({ noteId: note.id, key: 'Kunde' });

    await waitFor(() =>
      expect(notesApi.update).toHaveBeenCalledWith(note.id, {
        fieldChanges: { remove: ['Kunde'] },
      }),
    );
  });

  it('rolls both caches back when the request fails', async () => {
    const { note, queryClient, wrapper } = setup({ Kunde: 'Müller GmbH' });
    vi.mocked(notesApi.update).mockRejectedValue(new Error('nope'));

    const { result } = renderHook(() => useRemoveCustomField(boardId), { wrapper });
    result.current.mutate({ noteId: note.id, key: 'Kunde' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(listFields(queryClient, note.id)).toEqual({ Kunde: 'Müller GmbH' });
    expect(detailFields(queryClient, note.id)).toEqual({ Kunde: 'Müller GmbH' });
  });
});
