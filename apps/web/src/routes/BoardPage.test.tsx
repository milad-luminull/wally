import { describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { screen } from '@testing-library/react';

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
// Imported after the mocks so they resolve to the mocked modules.
import { boardsApi, meApi } from '@/lib/resources';
import { ApiError } from '@/lib/apiClient';
import { renderWithProviders } from '@/test/renderWithProviders';
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
    const back = await screen.findByRole('link', { name: 'Zurück zu deinen Wänden' });
    expect(back).toHaveAttribute('href', '/');
  });
});
