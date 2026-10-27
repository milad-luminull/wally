vi.mock('@/i18n/languageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/resources', () => ({
  boardsApi: { get: vi.fn(), list: vi.fn() },
  meApi: { get: vi.fn() },
}));
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => ({ status: 'authenticated' }) };
});
/** Every board the shell was mounted for, in order: a remount per board, never a reuse. */
const mounts: string[] = [];
vi.mock('@/features/board/AppShell', () => ({
  AppShell: ({ boardId }: { boardId: string }) => {
    useState(() => mounts.push(boardId));
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate('/boards/b')}>
        shell {boardId}
      </button>
    );
  },
}));
// Imported after the mocks so they resolve to the mocked modules.
import { boardsApi, meApi } from '@/lib/resources';
import { ApiError } from '@/lib/apiClient';
import { renderWithProviders } from '@/test/renderWithProviders';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { scopedQueryKeys } from '@/features/board/hooks/queryKeys';
import { BoardPage } from './BoardPage';

describe('BoardPage', () => {
  // A board deleted from another tab, or one the caller left, is a 404 from then on. The page
  // must say so and lead home, never strand them.
  it('shows the not-found page with a way back to the boards when the board is gone', async () => {
    vi.mocked(boardsApi.get).mockRejectedValue(new ApiError(404, null));
    vi.mocked(meApi.get).mockResolvedValue({ preferences: {} } as never);
    renderWithProviders(
      <Routes>
        <Route path="/boards/:boardId" element={<BoardPage />} />
      </Routes>,
      { route: '/boards/gone' },
    );
    const back = await screen.findByRole('link', { name: 'Back to your boards' });
    expect(back).toHaveAttribute('href', '/');
  });

  it('mounts a fresh shell for another board, so nothing of the first carries over', async () => {
    mounts.length = 0;
    vi.mocked(meApi.get).mockResolvedValue({ preferences: {} } as never);
    vi.mocked(boardsApi.get).mockImplementation(
      async (id: string) => ({ id, name: id, currentUserRole: 'OWNER' }) as never,
    );
    // The second board is already in the cache (opened before, or from the switcher), so the
    // page renders it at once, with no skeleton in between to unmount the shell.
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(scopedQueryKeys(null).board('b'), {
      id: 'b',
      name: 'b',
      currentUserRole: 'OWNER',
    });
    renderWithProviders(
      <Routes>
        <Route path="/boards/:boardId" element={<BoardPage />} />
      </Routes>,
      { route: '/boards/a', queryClient },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'shell a' }));
    await screen.findByRole('button', { name: 'shell b' });
    expect(mounts).toEqual(['a', 'b']);
  });
});
