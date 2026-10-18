import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { notesApi } from '@/lib/resources';
import { resetMutationSession } from '@/lib/mutationQueue';
import { dismissToast, resetToasts, useToasts } from '@/lib/toast';
import { scopedQueryKeys } from '../queryKeys';
import { useNotes } from '../useNotes';
import { useDeleteNote } from './useDeleteNote';
vi.mock('@/lib/resources', () => ({ notesApi: { list: vi.fn(), remove: vi.fn() } }));
const keys = scopedQueryKeys(null);

function setup() {
  let server = [makeNote({ id: 'first' }), makeNote({ id: 'second' })];
  vi.mocked(notesApi.list).mockImplementation(async () => [...server]);
  vi.mocked(notesApi.remove).mockImplementation(async (id) => {
    server = server.filter((note) => note.id !== id);
  });
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => ({
      notes: useNotes('board').data,
      ...useDeleteNote('board'),
      toasts: useToasts(),
    }),
    { wrapper },
  );
  const ids = () => hook.result.current.notes?.map((note) => note.id);
  return { ...hook, client, ids };
}

describe('delete undo windows', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetToasts();
    resetMutationSession();
  });

  it('keeps the second deletion hidden when the first deletion refreshes the board', async () => {
    const { result, ids, client } = setup();
    await waitFor(() => expect(ids()).toEqual(['first', 'second']));
    act(() => result.current.deleteNote('first'));
    const firstToast = result.current.toasts[0]!.id;
    act(() => result.current.deleteNote('second'));
    act(() => dismissToast(firstToast, { expired: true }));
    await waitFor(() => expect(notesApi.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(ids()).toEqual([]);
    expect(notesApi.remove).toHaveBeenCalledTimes(1);
    act(() => dismissToast(result.current.toasts[0]!.id, { expired: true }));
    await waitFor(() => expect(notesApi.remove).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(ids()).toEqual([]));
  });

  it('keeps a pending deletion hidden across other refreshes, and Undo restores it once', async () => {
    const { result, ids, client } = setup();
    await waitFor(() => expect(ids()).toHaveLength(2));
    act(() => result.current.deleteNote('second'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: keys.notes('board') });
    });
    expect(ids()).toEqual(['first']);
    act(() => result.current.toasts[0]!.action!.onClick());
    await waitFor(() => expect(ids()).toEqual(['first', 'second']));
    expect(notesApi.remove).not.toHaveBeenCalled();
  });

  it('restores a refused deletion without reviving another pending deletion', async () => {
    const { result, ids, client } = setup();
    await waitFor(() => expect(ids()).toHaveLength(2));
    vi.mocked(notesApi.remove).mockRejectedValueOnce(new Error('refused'));
    act(() => result.current.deleteNote('first'));
    const firstToast = result.current.toasts[0]!.id;
    act(() => result.current.deleteNote('second'));
    act(() => dismissToast(firstToast, { expired: true }));
    await waitFor(() => expect(notesApi.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await waitFor(() => expect(ids()).toEqual(['first']));
  });
});
