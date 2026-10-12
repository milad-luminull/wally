import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NoteDto } from '@wally/shared';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { resetToasts, useToasts } from '@/lib/toast';
import { queryKeys } from '../queryKeys';
import { useDuplicateNote } from './useDuplicateNote';

vi.mock('@/lib/resources', () => ({
  notesApi: { duplicate: vi.fn(), remove: vi.fn() },
}));

// Imported after the mock so it resolves to the mocked module.
import { notesApi } from '@/lib/resources';

const boardId = 'board-1';
const notesKey = queryKeys.notes(boardId);

describe('useDuplicateNote', () => {
  beforeEach(() => {
    vi.mocked(notesApi.duplicate).mockReset();
    vi.mocked(notesApi.remove).mockReset().mockResolvedValue(undefined);
    resetToasts();
  });

  function setup(source: NoteDto, onUndo = vi.fn()) {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData<NoteDto[]>(notesKey, [source]);

    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(
      () => ({ ...useDuplicateNote(boardId, { onUndo }), toasts: useToasts() }),
      { wrapper },
    );
    const notes = () => queryClient.getQueryData<NoteDto[]>(notesKey) ?? [];
    return { queryClient, result, notes, onUndo };
  }

  it('sends the cached title and description, nudged on the free canvas', async () => {
    vi.mocked(notesApi.duplicate).mockReturnValue(new Promise(() => {}));
    const { result } = setup(
      makeNote({
        id: 'note-1',
        title: 'Gerade getippt',
        description: 'Und das',
        freeX: 10,
        freeY: 20,
      }),
    );

    act(() => result.current.duplicate('note-1'));

    // The request leaves after onMutate has cancelled in-flight list fetches.
    await waitFor(() => expect(notesApi.duplicate).toHaveBeenCalled());
    expect(notesApi.duplicate).toHaveBeenCalledWith('note-1', {
      title: 'Gerade getippt',
      description: 'Und das',
      freeX: 34,
      freeY: 44,
    });
  });

  it('lets a drop placement override where the copy goes', async () => {
    vi.mocked(notesApi.duplicate).mockReturnValue(new Promise(() => {}));
    const { result } = setup(makeNote({ id: 'note-1', horizon: 'HEUTE' }));

    act(() => result.current.duplicate('note-1', { horizon: 'SPAETER', freeX: 500, freeY: 600 }));

    await waitFor(() => expect(notesApi.duplicate).toHaveBeenCalled());
    expect(notesApi.duplicate).toHaveBeenCalledWith(
      'note-1',
      expect.objectContaining({ horizon: 'SPAETER', freeX: 500, freeY: 600 }),
    );
  });

  it('shows an open copy at once and swaps in the server copy when it lands', async () => {
    const created = makeNote({ id: 'note-copy', title: 'Angebot' });
    let resolve!: (note: NoteDto) => void;
    vi.mocked(notesApi.duplicate).mockReturnValue(new Promise((r) => (resolve = r)));
    const { result, notes } = setup(
      makeNote({
        id: 'note-1',
        title: 'Angebot',
        status: 'DONE',
        completedAt: '2026-09-11T10:00:00.000Z',
      }),
    );
    const onSuccess = vi.fn();

    act(() => result.current.duplicate('note-1', undefined, { onSuccess }));

    await waitFor(() => expect(notes()).toHaveLength(2));
    const optimistic = notes()[1]!;
    expect(optimistic.id).toMatch(/^temp-/);
    expect(optimistic).toMatchObject({ title: 'Angebot', status: 'OPEN', completedAt: null });

    await act(async () => resolve(created));

    await waitFor(() => expect(notes().map((n) => n.id)).toEqual(['note-1', 'note-copy']));
    expect(onSuccess.mock.calls[0]?.[0]).toEqual(created);
    expect(result.current.toasts.map((t) => t.title)).toEqual(['toast.noteDuplicated']);
  });

  it('Undo removes the copy and deletes it on the server', async () => {
    const created = makeNote({ id: 'note-copy', title: 'Angebot' });
    vi.mocked(notesApi.duplicate).mockResolvedValue(created);
    const { result, notes, onUndo } = setup(makeNote({ id: 'note-1', title: 'Angebot' }));

    act(() => result.current.duplicate('note-1'));
    await waitFor(() => expect(result.current.toasts).toHaveLength(1));

    act(() => result.current.toasts[0]!.action!.onClick());

    expect(notes().map((n) => n.id)).toEqual(['note-1']);
    expect(notesApi.remove).toHaveBeenCalledWith('note-copy');
    expect(onUndo).toHaveBeenCalledWith('note-copy');
  });

  it('does nothing for a note that is still being created', () => {
    const { result } = setup(makeNote({ id: 'temp-123' }));

    act(() => result.current.duplicate('temp-123'));

    expect(notesApi.duplicate).not.toHaveBeenCalled();
  });
});
