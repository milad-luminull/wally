import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NoteDetailDto, NoteDto } from '@wally/shared';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { queryKeys } from '../queryKeys';
import { useRemoveCustomField, useSetCustomField } from './useCustomFieldMutations';

vi.mock('@/lib/resources', () => ({
  notesApi: { update: vi.fn() },
}));

// Imported after the mock so it resolves to the mocked module.
import { notesApi } from '@/lib/resources';

const boardId = 'board-1';

describe('custom field mutations', () => {
  beforeEach(() => {
    vi.mocked(notesApi.update).mockReset();
  });

  function setup(fields: Record<string, string>) {
    const note = makeNote({ customFields: fields });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.notes(boardId), [note]);
    queryClient.setQueryData(['notes', note.id], { ...note, subtasks: [], history: [] });

    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return { note, queryClient, wrapper };
  }

  const listFields = (queryClient: ReturnType<typeof createTestQueryClient>, id: string) =>
    queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId))?.find((n) => n.id === id)
      ?.customFields;

  const detailFields = (queryClient: ReturnType<typeof createTestQueryClient>, id: string) =>
    queryClient.getQueryData<NoteDetailDto>(['notes', id])?.customFields;

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

  it('overwrites an existing property whose key differs only in case', async () => {
    const { note, wrapper } = setup({ Kunde: 'Müller GmbH' });
    vi.mocked(notesApi.update).mockResolvedValue(note);

    const { result } = renderHook(() => useSetCustomField(boardId), { wrapper });
    result.current.mutate({ noteId: note.id, key: 'kunde', value: 'Steiner AG' });

    // The stored spelling wins, so the note keeps one property rather than gaining a twin.
    await waitFor(() =>
      expect(notesApi.update).toHaveBeenCalledWith(note.id, {
        customFields: { Kunde: 'Steiner AG' },
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
