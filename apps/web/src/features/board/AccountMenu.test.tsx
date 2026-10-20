import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUseAuth = vi.fn();
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => mockUseAuth() };
});

const mockUseLanguage = vi.fn();
vi.mock('@/i18n/LanguageProvider', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/LanguageProvider')>('@/i18n/LanguageProvider');
  return { ...actual, useLanguage: () => mockUseLanguage() };
});

const mockUseWallybotPreferences = vi.fn();
vi.mock('@/lib/preferences', async () => {
  const actual = await vi.importActual<typeof import('@/lib/preferences')>('@/lib/preferences');
  return { ...actual, useWallybotPreferences: () => mockUseWallybotPreferences() };
});

import { renderWithProviders } from '@/test/renderWithProviders';
import { AccountMenu } from './AccountMenu';

describe('AccountMenu', () => {
  let setLanguage: ReturnType<typeof vi.fn>;
  let setWallybot: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setLanguage = vi.fn();
    mockUseAuth.mockReturnValue({
      user: { displayName: 'Mika Brandt', email: 'mika@example.com' },
      signOut: vi.fn(),
    });
    mockUseLanguage.mockReturnValue({
      language: 'en',
      setLanguage,
      isSaving: false,
      saveFailed: false,
    });
    setWallybot = vi.fn();
    mockUseWallybotPreferences.mockReturnValue([{ autoApply: true }, setWallybot]);
  });

  async function openMenu() {
    const user = userEvent.setup();
    renderWithProviders(<AccountMenu />);
    await user.click(screen.getByRole('button', { name: 'Account' }));
    return user;
  }

  it('offers a labelled language control showing the active language', async () => {
    await openMenu();

    // getByLabelText, not a test id: the label association is the accessibility contract.
    expect(screen.getByLabelText('Language')).toHaveTextContent('English');
  });

  it('links to account connection settings', async () => {
    await openMenu();
    expect(screen.getByRole('link', { name: 'AI connections' })).toHaveAttribute(
      'href',
      '/settings/connections',
    );
  });

  /**
   * Given a longer timeout than the 20s default: this drives two nested Radix layers (the
   * popover, then the select), and Radix in jsdom costs ~8s per layer in this repo — see the
   * runtimes on the ShareSheet and BoardSwitcher popover suites. It fits on a dev machine but
   * tipped over the default inside the container.
   */
  it('switches language from the keyboard', async () => {
    const user = await openMenu();

    await user.click(screen.getByLabelText('Language'));
    // Endonyms are never translated, so a user stranded in the wrong language can still
    // recognise their own.
    await user.click(await screen.findByRole('option', { name: 'Deutsch' }));

    expect(setLanguage).toHaveBeenCalledWith('de');
  }, 60_000);

  it('announces a failed save rather than silently reverting', async () => {
    mockUseLanguage.mockReturnValue({
      language: 'en',
      setLanguage,
      isSaving: false,
      saveFailed: true,
    });

    await openMenu();

    expect(screen.getByRole('status')).toHaveTextContent('Could not save your language.');
  });

  it('offers "always ask me" for Wallybot and saves the switch', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountMenu />);
    await user.click(screen.getByRole('button', { name: 'Account' }));
    const alwaysAsk = screen.getByRole('switch', { name: 'Always ask me' });
    expect(alwaysAsk).toHaveAttribute('aria-checked', 'false');
    // The hint under the label is what the switch does; a screen reader hears it with it.
    expect(alwaysAsk).toHaveAccessibleDescription(
      'Always ask me: suggestions wait for Enter instead of applying on their own.',
    );
    await user.click(alwaysAsk);
    expect(setWallybot).toHaveBeenCalledWith({ autoApply: false });
  });
});
