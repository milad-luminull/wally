import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { WhiteboardSummaryDto } from '@wally/shared';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { makeBoard } from '@/test/fixtures';
import { scopedQueryKeys } from '../queryKeys';

vi.mock('@/lib/resources', () => ({
  boardsApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn(), leave: vi.fn() },
}));
// Imported after the mock so it resolves to the mocked module.
import { boardsApi } from '@/lib/resources';
import { useCreateBoard } from './useCreateBoard';
import { useDeleteBoard } from './useDeleteBoard';
import { useLeaveBoard } from './useLeaveBoard';

// Hooks rendered outside AuthProvider read and write the signed-out scope.
const keys = scopedQueryKeys(null);
const own: WhiteboardSummaryDto = { id: 'own', name: 'Meine Wand', currentUserRole: 'OWNER' };
const shared: WhiteboardSummaryDto = { id: 'shared', name: 'Team Nord', currentUserRole: 'EDIT' };

function setup<T>(hook: () => T, boards: WhiteboardSummaryDto[] = [own, shared]) {
  const queryClient: QueryClient = createTestQueryClient();
  queryClient.setQueryData(keys.meBoards(), boards);
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const { result } = renderHook(hook, { wrapper });
  return { queryClient, result };
}

const listed = (queryClient: QueryClient) =>
  queryClient.getQueryData<WhiteboardSummaryDto[]>(keys.meBoards())?.map((b) => b.id);

describe('board lifecycle hooks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(boardsApi.list).mockImplementation(() => new Promise(() => {}));
  });

  it('useCreateBoard adds the new board to the list and primes its board cache', async () => {
    const created = makeBoard({ id: 'new', name: 'Projekt Nord' });
    vi.mocked(boardsApi.create).mockResolvedValue(created);
    const { queryClient, result } = setup(() => useCreateBoard());

    await act(() => result.current.mutateAsync({ name: 'Projekt Nord' }));

    expect(listed(queryClient)).toEqual(['own', 'shared', 'new']);
    expect(queryClient.getQueryData(keys.board('new'))).toEqual(created);
  });

  // A lost response followed by pressing Create again must replay, not create a second board;
  // a different name is a different request and needs its own operation id.
  it('useCreateBoard reuses its ticket for the same name and mints one for a new name', async () => {
    vi.mocked(boardsApi.create).mockRejectedValue(new TypeError('lost response'));
    const { result } = setup(() => useCreateBoard());

    await act(() => result.current.mutateAsync({ name: 'A' }).catch(() => {}));
    await act(() => result.current.mutateAsync({ name: 'A' }).catch(() => {}));
    await act(() => result.current.mutateAsync({ name: 'B' }).catch(() => {}));

    const tickets = vi.mocked(boardsApi.create).mock.calls.map((call) => call[1]!.operationId);
    expect(tickets[0]).toBe(tickets[1]);
    expect(tickets[2]).not.toBe(tickets[0]);
  });

  it('useDeleteBoard sends the board revision and drops the board from every cache', async () => {
    vi.mocked(boardsApi.get).mockResolvedValue(makeBoard({ id: 'own', revision: 7 }));
    vi.mocked(boardsApi.remove).mockResolvedValue(undefined);
    const { queryClient, result } = setup(() => useDeleteBoard('own'));
    queryClient.setQueryData(keys.notes('own'), []);

    await act(() => result.current.mutateAsync());

    expect(vi.mocked(boardsApi.remove).mock.calls[0]![1]!.revision).toBe(7);
    expect(listed(queryClient)).toEqual(['shared']);
    expect(queryClient.getQueryData(keys.board('own'))).toBeUndefined();
    expect(queryClient.getQueryData(keys.notes('own'))).toBeUndefined();
  });

  it('useDeleteBoard brings the row back when the request fails', async () => {
    vi.mocked(boardsApi.get).mockResolvedValue(makeBoard({ id: 'own', revision: 7 }));
    vi.mocked(boardsApi.remove).mockRejectedValue(new Error('offline'));
    vi.mocked(boardsApi.list).mockResolvedValue([own, shared]);
    const { queryClient, result } = setup(() => useDeleteBoard('own'));

    await act(() => result.current.mutateAsync().catch(() => {}));

    await waitFor(() => expect(listed(queryClient)).toEqual(['own', 'shared']));
  });

  it('useLeaveBoard drops the board from every cache', async () => {
    vi.mocked(boardsApi.leave).mockResolvedValue(undefined);
    const { queryClient, result } = setup(() => useLeaveBoard('shared'));
    queryClient.setQueryData(keys.members('shared'), []);

    await act(() => result.current.mutateAsync());

    expect(boardsApi.leave).toHaveBeenCalledWith('shared');
    expect(listed(queryClient)).toEqual(['own']);
    expect(queryClient.getQueryData(keys.members('shared'))).toBeUndefined();
  });
});
