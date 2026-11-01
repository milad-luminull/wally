import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/resources', () => ({ boardsApi: { list: vi.fn() } }));
// Imported after the mock so it resolves to the mocked module.
import { boardsApi } from '@/lib/resources';

const mockUseAuth = vi.fn();
vi.mock('./AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('./AuthProvider')>('./AuthProvider');
  return { ...actual, useAuth: () => mockUseAuth() };
});

import { createTestQueryClient, renderWithProviders } from '@/test/renderWithProviders';
import { makeBoard } from '@/test/fixtures';
import { EmailVerificationBanner } from './EmailVerificationBanner';

describe('EmailVerificationBanner', () => {
  let refreshUser: ReturnType<typeof vi.fn>;
  // Read on every render, the way the real provider's state is: refreshUser flipping this
  // is what makes the banner swap to its confirmed state.
  let verified = false;

  function arrange(overrides: Record<string, unknown> = {}) {
    mockUseAuth.mockImplementation(() => ({
      user: { email: 'max@example.com' },
      emailVerified: verified,
      refreshUser,
      hostedLogin: async () => {},
      ...overrides,
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    verified = false;
    refreshUser = vi.fn().mockImplementation(async () => {
      verified = true;
      return true;
    });
    vi.mocked(boardsApi.list).mockResolvedValue([]);
    arrange();
  });

  it('shows failed and still-unverified checks', async () => {
    refreshUser.mockResolvedValue(false);
    renderWithProviders(<EmailVerificationBanner />);
    await userEvent.click(screen.getByRole('button', { name: "I've confirmed" }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not confirmed yet');
    refreshUser.mockRejectedValue(new Error('offline'));
    await userEvent.click(screen.getByRole('button', { name: "I've confirmed" }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t check that. Try again.');
  });

  it('refetches boards after verification even when the old list is fresh in cache', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['u', 'anon', 'me', 'boards'], []);
    vi.mocked(boardsApi.list).mockResolvedValue([
      makeBoard({ id: 'shared', name: 'New Team', currentUserRole: 'EDIT' }),
    ]);
    renderWithProviders(<EmailVerificationBanner />, { queryClient });
    await userEvent.click(screen.getByRole('button', { name: "I've confirmed" }));
    expect(await screen.findByRole('link', { name: 'Open board' })).toHaveAttribute(
      'href',
      '/boards/shared',
    );
  });

  it('renders nothing once the address is verified', () => {
    arrange({ emailVerified: true });
    const { container } = renderWithProviders(<EmailVerificationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('points to the login service for verification and never offers a resend', () => {
    renderWithProviders(<EmailVerificationBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Verify your email using the message from our login service',
    );
    expect(screen.getByRole('button', { name: "I've confirmed" })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resend/ })).toBeNull();
  });

  it('keeps the banner up when the address is still unconfirmed after a check', async () => {
    const user = userEvent.setup();
    refreshUser.mockImplementation(async () => false);
    renderWithProviders(<EmailVerificationBanner />);

    await user.click(screen.getByRole('button', { name: "I've confirmed" }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Not confirmed yet');
    expect(screen.getByRole('button', { name: "I've confirmed" })).toBeInTheDocument();
  });

  /**
   * The API activates a pending invite lazily, in its auth preHandler, on the first request
   * carrying a token with email_verified. Refetching before that token exists activates
   * nothing and leaves the user looking at a board list that still excludes the board they
   * were invited to.
   */
  it('invalidates the query cache after the token refresh, never before', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    refreshUser.mockImplementation(async () => {
      order.push('refreshUser');
      verified = true;
      return true;
    });
    const queryClient = createTestQueryClient();
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async () => {
      order.push('invalidateQueries');
    });

    renderWithProviders(<EmailVerificationBanner />, { queryClient });
    await user.click(screen.getByRole('button', { name: "I've confirmed" }));

    await waitFor(() => expect(order).toEqual(['refreshUser', 'invalidateQueries']));
  });

  it('links to the board that the confirmed address just unlocked', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.list).mockResolvedValue([
      makeBoard({ id: 'own', name: 'My Board', currentUserRole: 'OWNER' }),
      makeBoard({ id: 'shared', name: 'Team North', currentUserRole: 'EDIT' }),
    ]);
    renderWithProviders(<EmailVerificationBanner />);

    await user.click(screen.getByRole('button', { name: "I've confirmed" }));

    // There is no board switcher in the app, so without this the newly activated invite is
    // invisible: the user stays on their own board with no way to reach the shared one.
    expect(await screen.findByText(/Team North/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open board' })).toHaveAttribute(
      'href',
      '/boards/shared',
    );
  });
});
