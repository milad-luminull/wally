import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NoteDetailDto, NoteDto, UserSummary } from '@wally/shared';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { ApiError } from '@/lib/apiClient';
import { scopedQueryKeys } from '../queryKeys';
import { useSetNoteVisibility } from './useSetNoteVisibility';

vi.mock('@/lib/resources', () => ({
  notesApi: { update: vi.fn() },
}));

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }));

// Imported after the mocks so they resolve to the mocked modules.
import { notesApi } from '@/lib/resources';
import { toast } from '@/lib/toast';

// Hooks rendered outside AuthProvider read and write the signed-out scope.
const queryKeys = scopedQueryKeys(null);
const boardId = 'board-1';

const me: UserSummary = { id: 'user-me', email: 'me@example.com', displayName: 'Me' };
const other: UserSummary = { id: 'user-other', email: 'other@example.com', displayName: 'Other' };

describe('useSetNoteVisibility', () => {
  beforeEach(() => {
    vi.mocked(notesApi.update).mockReset();
    vi.mocked(toast).mockReset();
  });

  function setup() {
    const note = makeNote({ id: 'n1', createdBy: me, assignee: other });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.notes(boardId), [note]);
    queryClient.setQueryData(queryKeys.noteDetail(note.id), { ...note, subtasks: [], history: [] });

    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return { note, queryClient, wrapper };
  }

  const listNote = (queryClient: ReturnType<typeof createTestQueryClient>) =>
    queryClient.getQueryData<NoteDto[]>(queryKeys.notes(boardId))?.find((n) => n.id === 'n1');
  const detailNote = (queryClient: ReturnType<typeof createTestQueryClient>) =>
    queryClient.getQueryData<NoteDetailDto>(queryKeys.noteDetail('n1'));

  it('makes the note private and the creator its assignee, in the list and the detail', async () => {
    const { queryClient, wrapper } = setup();
    vi.mocked(notesApi.update).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSetNoteVisibility(boardId), { wrapper });
    result.current.mutate({ noteId: 'n1', visibility: 'PRIVATE', creator: me });

    await waitFor(() => {
      expect(listNote(queryClient)).toMatchObject({ visibility: 'PRIVATE', assignee: me });
      expect(detailNote(queryClient)).toMatchObject({ visibility: 'PRIVATE', assignee: me });
    });
    expect(notesApi.update).toHaveBeenCalledWith(
      'n1',
      { visibility: 'PRIVATE' },
      expect.objectContaining({ resource: 'note:n1' }),
    );
  });

  it('rolls visibility and assignee back together when the server refuses', async () => {
    const { queryClient, wrapper } = setup();
    vi.mocked(notesApi.update).mockRejectedValue(new ApiError(409, { error: 'conflict' }));

    const { result } = renderHook(() => useSetNoteVisibility(boardId), { wrapper });
    result.current.mutate({ noteId: 'n1', visibility: 'PRIVATE', creator: me });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(listNote(queryClient)).toMatchObject({ visibility: 'SHARED', assignee: other });
    expect(detailNote(queryClient)).toMatchObject({ visibility: 'SHARED', assignee: other });
    expect(toast).not.toHaveBeenCalled();
  });

  it('says so once the note is private', async () => {
    const { note, wrapper } = setup();
    vi.mocked(notesApi.update).mockResolvedValue({ ...note, visibility: 'PRIVATE' });

    const { result } = renderHook(() => useSetNoteVisibility(boardId), { wrapper });
    result.current.mutate({ noteId: 'n1', visibility: 'PRIVATE', creator: me });

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'toast.notePrivate' }));
  });

  it('says so once the note is shared again', async () => {
    const { note, wrapper } = setup();
    vi.mocked(notesApi.update).mockResolvedValue({ ...note, visibility: 'SHARED' });

    const { result } = renderHook(() => useSetNoteVisibility(boardId), { wrapper });
    result.current.mutate({ noteId: 'n1', visibility: 'SHARED', creator: me });

    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: 'toast.noteShared' }));
  });
});
