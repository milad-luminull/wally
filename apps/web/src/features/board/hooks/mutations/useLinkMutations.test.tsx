import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { NoteDto } from '@wally/shared';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { scopedQueryKeys } from '../queryKeys';
import { useAddLink, useRemoveLink } from './useLinkMutations';
import { notesApi } from '@/lib/resources';
vi.mock('@/lib/resources', () => ({ notesApi: { update: vi.fn() } }));
const keys = scopedQueryKeys(null);
describe('link mutations', () => {
  beforeEach(() => {
    vi.mocked(notesApi.update).mockReset();
  });
  function setup() {
    const note = makeNote({ links: ['b'] });
    const client = createTestQueryClient();
    client.setQueryData(keys.notes('board'), [note]);
    client.setQueryData(keys.noteDetail(note.id), { ...note, subtasks: [], history: [] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const links = () => [
      client.getQueryData<NoteDto[]>(keys.notes('board'))![0]!.links,
      client.getQueryData<NoteDto>(keys.noteDetail(note.id))!.links,
    ];
    return { note, wrapper, links };
  }
  it('adds only the target and updates both caches before the server responds', async () => {
    const { note, wrapper, links } = setup();
    vi.mocked(notesApi.update).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAddLink('board'), { wrapper });
    result.current.mutate({ noteId: note.id, targetId: 'c' });
    await waitFor(() =>
      expect(links()).toEqual([
        ['b', 'c'],
        ['b', 'c'],
      ]),
    );
    expect(notesApi.update).toHaveBeenCalledWith(
      note.id,
      { linkChanges: { add: ['c'] } },
      expect.any(Object),
    );
  });
  it('removes only the target from both caches', async () => {
    const { note, wrapper, links } = setup();
    vi.mocked(notesApi.update).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useRemoveLink('board'), { wrapper });
    result.current.mutate({ noteId: note.id, targetId: 'b' });
    await waitFor(() => expect(links()).toEqual([[], []]));
    expect(notesApi.update).toHaveBeenCalledWith(
      note.id,
      { linkChanges: { remove: ['b'] } },
      expect.any(Object),
    );
  });
  it('restores both caches after a refused addition', async () => {
    const { note, wrapper, links } = setup();
    vi.mocked(notesApi.update).mockRejectedValue(new Error('refused'));
    const { result } = renderHook(() => useAddLink('board'), { wrapper });
    result.current.mutate({ noteId: note.id, targetId: 'c' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(links()).toEqual([['b'], ['b']]);
  });
});
