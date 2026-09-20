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
  const actual = await vi.importActual<typeof import('@/i18n/LanguageProvider')>(
    '@/i18n/LanguageProvider',
  );
  return { ...actual, useLanguage: () => mockUseLanguage() };
});

import { renderWithProviders } from '@/test/renderWithProviders';
import { AccountMenu } from './AccountMenu';

describe('AccountMenu', () => {
  let setLanguage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setLanguage = vi.fn();
    mockUseAuth.mockReturnValue({
      user: { displayName: 'Max Berger', email: 'max@finlex.de' },
      signOut: vi.fn(),
    });
    mockUseLanguage.mockReturnValue({
      language: 'de',
      setLanguage,
      isSaving: false,
      saveFailed: false,
    });
  });

  async function openMenu() {
    const user = userEvent.setup();
    renderWithProviders(<AccountMenu />);
    await user.click(screen.getByRole('button', { name: 'Konto' }));
    return user;
  }

  it('offers a labelled language control showing the active language', async () => {
    await openMenu();

    // getByLabelText, not a test id: the label association is the accessibility contract.
    expect(screen.getByLabelText('Sprache')).toHaveTextContent('Deutsch');
  });

  /**
   * Given a longer timeout than the 20s default: this drives two nested Radix layers (the
   * popover, then the select), and Radix in jsdom costs ~8s per layer in this repo — see the
   * runtimes on the ShareSheet and BoardSwitcher popover suites. It fits on a dev machine but
   * tipped over the default inside the container.
   */
  it(
    'switches language from the keyboard',
    async () => {
      const user = await openMenu();

      await user.click(screen.getByLabelText('Sprache'));
      // Endonyms are never translated, so a user stranded in the wrong language can still
      // recognise their own.
      await user.click(await screen.findByRole('option', { name: 'English' }));

      expect(setLanguage).toHaveBeenCalledWith('en');
    },
    60_000,
  );

  it('announces a failed save rather than silently reverting', async () => {
    mockUseLanguage.mockReturnValue({
      language: 'de',
      setLanguage,
      isSaving: false,
      saveFailed: true,
    });

    await openMenu();

    expect(screen.getByRole('status')).toHaveTextContent('Sprache konnte nicht gespeichert werden.');
  });
});
