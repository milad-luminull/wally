import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NoteDetailDto } from '@wally/shared';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { useCreateNote } from './useCreateNote';

vi.mock('@/lib/resources', () => ({
  notesApi: { create: vi.fn() },
}));

// Imported after the mock so it resolves to the mocked module.
import { notesApi } from '@/lib/resources';

const boardId = 'board-1';

describe('useCreateNote', () => {
  beforeEach(() => {
    vi.mocked(notesApi.create).mockReset();
  });

  function setup() {
    const queryClient = createTestQueryClient();

    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useCreateNote(boardId), { wrapper });
    return { queryClient, result };
  }

  /**
   * POST /notes answers with the LIGHT list DTO — no subtasks[]/history[] (see
   * lib/resources.ts). The detail cache key is read by useNoteDetail, whose consumers
   * (SubtaskChecklist, HistoryTrail) index those arrays directly, so seeding that key with
   * the create response crashed the panel the first time a freshly created note was opened.
   */
  it('never leaves a detail-cache entry that is missing subtasks[]/history[]', async () => {
    const created = makeNote({ id: 'note-real', title: 'Neue Notiz' });
    vi.mocked(notesApi.create).mockResolvedValue(created);

    const { queryClient, result } = setup();
    result.current.mutate({ title: 'Neue Notiz' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const detail = queryClient.getQueryData<NoteDetailDto>(['notes', created.id]);
    if (detail !== undefined) {
      expect(Array.isArray(detail.subtasks)).toBe(true);
      expect(Array.isArray(detail.history)).toBe(true);
    }
  });
});

it('cannot repopulate account caches after a delayed query cancellation completes', async () => {
  const { resetMutationSession } = await import('@/lib/mutationQueue');
  resetMutationSession();
  const queryClient = createTestQueryClient();
  let resume!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    resume = resolve;
  });
  vi.spyOn(queryClient, 'cancelQueries').mockReturnValue(cancelled);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCreateNote(boardId), { wrapper });
  result.current.mutate({ title: 'Old private text' });
  await waitFor(() => expect(queryClient.cancelQueries).toHaveBeenCalled());
  resetMutationSession();
  queryClient.clear();
  resume();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});
