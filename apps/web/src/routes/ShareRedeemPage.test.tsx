import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/resources', () => ({ shareLinkApi: { redeem: vi.fn() } }));
// Imported after the mock so it resolves to the mocked module.
import { shareLinkApi } from '@/lib/resources';

const mockUseAuth = vi.fn();
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => mockUseAuth() };
});

import { ApiError } from '@/lib/apiClient';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { queryKeys } from '@/features/board/hooks/queryKeys';
import { createTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { ShareRedeemPage } from './ShareRedeemPage';

/** Stands in for the board the token unlocks, so a redirect is observable. */
function BoardStub() {
  return <p>Wand geöffnet</p>;
}

/** Echoes the location ProtectedRoute stashed, so the return path is observable. */
function LoginStub() {
  const location = useLocation();
  return <p>Login → {(location.state as { from?: string } | null)?.from}</p>;
}

function routes() {
  return (
    <Routes>
      <Route path="/share/:token" element={<ShareRedeemPage />} />
      <Route path="/boards/:boardId" element={<BoardStub />} />
    </Routes>
  );
}

describe('ShareRedeemPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    vi.mocked(shareLinkApi.redeem).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redeems the token and replaces the URL with the board it unlocked', async () => {
    vi.mocked(shareLinkApi.redeem).mockResolvedValue({ whiteboardId: 'board-1', role: 'EDIT' });

    renderWithProviders(routes(), { route: '/share/tok-1' });

    expect(await screen.findByText('Wand geöffnet')).toBeInTheDocument();
    expect(shareLinkApi.redeem).toHaveBeenCalledWith('tok-1');
  });

  /**
   * useMutation does not dedupe, so React's double-invoked mount effect fired the redeem
   * POST twice. Redemption is idempotent server-side, but the second call is a wasted
   * round trip on every share link anyone opens.
   */
  it('redeems only once when React double-invokes the mount effect', async () => {
    vi.mocked(shareLinkApi.redeem).mockResolvedValue({ whiteboardId: 'board-1', role: 'VIEW' });

    renderWithProviders(<StrictMode>{routes()}</StrictMode>, { route: '/share/tok-1' });

    expect(await screen.findByText('Wand geöffnet')).toBeInTheDocument();
    expect(shareLinkApi.redeem).toHaveBeenCalledTimes(1);
  });

  it('explains that a rotated link is no longer valid instead of showing a blank 404', async () => {
    vi.mocked(shareLinkApi.redeem).mockRejectedValue(new ApiError(404, null));

    renderWithProviders(routes(), { route: '/share/tok-gone' });

    expect(await screen.findByText('Dieser Link funktioniert nicht mehr')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zu deiner Wand' })).toBeInTheDocument();
  });

  it('offers a retry when redemption fails for an unexpected reason', async () => {
    const user = userEvent.setup();
    vi.mocked(shareLinkApi.redeem).mockRejectedValue(new ApiError(500, null));

    renderWithProviders(routes(), { route: '/share/tok-1' });

    await user.click(await screen.findByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(shareLinkApi.redeem).toHaveBeenCalledTimes(2));
  });

  it('refreshes the boards list after a successful redemption', async () => {
    vi.mocked(shareLinkApi.redeem).mockResolvedValue({ whiteboardId: 'board-1', role: 'EDIT' });
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    renderWithProviders(routes(), { route: '/share/tok-1', queryClient });

    await screen.findByText('Wand geöffnet');
    // The membership is new, so the caller's board list no longer reflects what they can see.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.meBoards() });
  });

  it('sends an anonymous visitor to the login page and back to the share link afterwards', async () => {
    mockUseAuth.mockReturnValue({ status: 'unauthenticated' });

    renderWithProviders(
      <Routes>
        <Route
          path="/share/:token"
          element={
            <ProtectedRoute>
              <ShareRedeemPage />
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<LoginStub />} />
      </Routes>,
      { route: '/share/tok-1' },
    );

    // The token has to survive the round trip through login, or the invited colleague ends
    // up on their own empty board with the link gone from history.
    expect(await screen.findByText('Login → /share/tok-1')).toBeInTheDocument();
    expect(shareLinkApi.redeem).not.toHaveBeenCalled();
  });
});
