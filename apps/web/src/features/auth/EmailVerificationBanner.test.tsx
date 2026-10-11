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

const HEADLINE = 'Bestätige deine E-Mail-Adresse';

describe('EmailVerificationBanner', () => {
  let resendVerificationEmail: ReturnType<typeof vi.fn>;
  let refreshUser: ReturnType<typeof vi.fn>;
  // Read on every render, the way the real provider's state is: refreshUser flipping this
  // is what makes the banner swap to its confirmed state.
  let verified = false;

  function arrange(overrides: Record<string, unknown> = {}) {
    mockUseAuth.mockImplementation(() => ({
      user: { email: 'max@example.com' },
      emailVerified: verified,
      resendVerificationEmail,
      refreshUser,
      ...overrides,
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    verified = false;
    resendVerificationEmail = vi.fn().mockResolvedValue(undefined);
    refreshUser = vi.fn().mockImplementation(async () => {
      verified = true;
      return true;
    });
    vi.mocked(boardsApi.list).mockResolvedValue([]);
    arrange();
  });

  it('renders nothing once the address is verified', () => {
    arrange({ emailVerified: true });
    const { container } = renderWithProviders(<EmailVerificationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains that an invite stays blocked until the address is confirmed', () => {
    renderWithProviders(<EmailVerificationBanner />);

    expect(screen.getByText(HEADLINE)).toBeInTheDocument();
    // The address is named, so a typo at sign-up is visible rather than mysterious.
    expect(screen.getByText('max@example.com')).toBeInTheDocument();
    expect(screen.getByText(/eingeladen wurdest/)).toBeInTheDocument();
  });

  it('sends another verification email and confirms it went out', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EmailVerificationBanner />);

    await user.click(screen.getByRole('button', { name: 'E-Mail erneut senden' }));

    expect(resendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/E-Mail gesendet/)).toBeInTheDocument();
  });

  it('blocks a second send during the cooldown window', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EmailVerificationBanner />);

    await user.click(screen.getByRole('button', { name: 'E-Mail erneut senden' }));

    // Asserted as disabled rather than by advancing timers: fake timers are a documented
    // flakiness source in this suite.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Erneut senden in/ })).toBeDisabled(),
    );
    expect(resendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('names the rate limit instead of a generic failure', async () => {
    const user = userEvent.setup();
    resendVerificationEmail.mockRejectedValue({ code: 'auth/too-many-requests' });
    renderWithProviders(<EmailVerificationBanner />);

    await user.click(screen.getByRole('button', { name: 'E-Mail erneut senden' }));

    // "Try again" on a throttle the user cannot clear by trying again is actively unhelpful.
    expect(await screen.findByRole('alert')).toHaveTextContent('Zu viele Versuche');
  });

  it('keeps the banner up when the address is still unconfirmed after a check', async () => {
    const user = userEvent.setup();
    refreshUser.mockImplementation(async () => false);
    renderWithProviders(<EmailVerificationBanner />);

    await user.click(screen.getByRole('button', { name: 'Ich habe bestätigt' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Noch nicht bestätigt');
    expect(screen.getByText(HEADLINE)).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Ich habe bestätigt' }));

    await waitFor(() => expect(order).toEqual(['refreshUser', 'invalidateQueries']));
  });

  it('links to the board that the confirmed address just unlocked', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.list).mockResolvedValue([
      makeBoard({ id: 'own', name: 'Meine Wand', currentUserRole: 'OWNER' }),
      makeBoard({ id: 'shared', name: 'Team Nord', currentUserRole: 'EDIT' }),
    ]);
    renderWithProviders(<EmailVerificationBanner />);

    await user.click(screen.getByRole('button', { name: 'Ich habe bestätigt' }));

    // There is no board switcher in the app, so without this the newly activated invite is
    // invisible: the user stays on their own board with no way to reach the shared one.
    expect(await screen.findByText(/Team Nord/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wand öffnen' })).toHaveAttribute(
      'href',
      '/boards/shared',
    );
  });
});
