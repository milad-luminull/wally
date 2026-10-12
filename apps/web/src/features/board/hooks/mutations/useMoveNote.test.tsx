import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NoteDto } from '@wally/shared';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { scopedQueryKeys } from '../queryKeys';
import { useMoveNote } from './useMoveNote';

vi.mock('@/lib/resources', () => ({
  notesApi: { move: vi.fn() },
}));

// Imported after the mock so it resolves to the mocked module.
import { notesApi } from '@/lib/resources';

// Hooks rendered outside AuthProvider read and write the signed-out scope.
const queryKeys = scopedQueryKeys(null);

const boardId = 'board-1';

describe('useMoveNote', () => {
  beforeEach(() => {
    vi.mocked(notesApi.move).mockReset();
  });

  function setup(initialNote: NoteDto) {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.notes(boardId), [initialNote]);
    queryClient.setQueryData(queryKeys.noteDetail(initialNote.id), {
      ...initialNote,
      subtasks: [],
      history: [],
    });

    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useMoveNote(boardId), { wrapper });
    return { queryClient, result };
  }

  it('optimistically patches the notes-list cache before the request resolves, then keeps it on success', async () => {
    const note = makeNote({ horizon: 'HEUTE' });
    let resolveMove!: (value: Awaited<ReturnType<typeof notesApi.move>>) => void;
    vi.mocked(notesApi.move).mockReturnValue(new Promise((resolve) => (resolveMove = resolve)));

    const { queryClient, result } = setup(note);

    result.current.mutate({ noteId: note.id, input: { mode: 'HORIZON', horizon: 'SPAETER' } });

    await waitFor(() => {
      const cached = queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId));
      expect(cached?.[0]?.horizon).toBe('SPAETER');
    });

    resolveMove({ ...note, horizon: 'SPAETER' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId));
    expect(cached?.[0]?.horizon).toBe('SPAETER');
  });

  it('rolls back the optimistic patch when the request fails', async () => {
    const note = makeNote({ horizon: 'HEUTE' });
    let rejectMove!: (err: unknown) => void;
    vi.mocked(notesApi.move).mockReturnValue(
      new Promise((_resolve, reject) => (rejectMove = reject)),
    );

    const { queryClient, result } = setup(note);

    result.current.mutate({ noteId: note.id, input: { mode: 'HORIZON', horizon: 'SPAETER' } });

    await waitFor(() => {
      const cached = queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId));
      expect(cached?.[0]?.horizon).toBe('SPAETER');
    });

    rejectMove(new Error('network error'));

    await waitFor(() => {
      const cached = queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId));
      expect(cached?.[0]?.horizon).toBe('HEUTE');
    });
    expect(result.current.isError).toBe(true);
  });

  it('only patches the field for the given move mode (priority move never touches horizon)', async () => {
    const note = makeNote({ horizon: 'HEUTE', priority: 'MITTEL' });
    vi.mocked(notesApi.move).mockReturnValue(new Promise(() => {}));
    const { queryClient, result } = setup(note);

    result.current.mutate({ noteId: note.id, input: { mode: 'PRIORITY', priority: 'HOCH' } });

    await waitFor(() => {
      const cached = queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId));
      expect(cached?.[0]?.priority).toBe('HOCH');
      expect(cached?.[0]?.horizon).toBe('HEUTE');
    });
  });
});
