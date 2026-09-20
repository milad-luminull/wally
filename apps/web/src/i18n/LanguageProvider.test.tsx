import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/resources', () => ({ meApi: { get: vi.fn(), updateLanguage: vi.fn() } }));
// Imported after the mock so it resolves to the mocked module.
import { meApi } from '@/lib/resources';

const mockUseAuth = vi.fn();
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => mockUseAuth() };
});

import type { MeDto } from '@wally/shared';
import { renderWithProviders } from '@/test/renderWithProviders';
import { i18n } from './index';
import { LanguageProvider, useLanguage } from './LanguageProvider';
import { writeStoredLocale } from './storage';

/** Exercises the provider through a consumer, the way the account menu uses it. */
function Probe() {
  const { language, setLanguage, saveFailed } = useLanguage();
  return (
    <div>
      <span data-testid="language">{language}</span>
      {saveFailed && <span role="alert">save failed</span>}
      <button type="button" onClick={() => setLanguage('en')}>
        to english
      </button>
      <button type="button" onClick={() => setLanguage('de')}>
        to german
      </button>
    </div>
  );
}

const PROFILE: MeDto = { id: 'u1', email: 'max@finlex.de', displayName: 'Max', language: 'de' };

/**
 * The fake is stateful because the real endpoint is: PATCH /me persists, so the refetch that
 * follows it answers with the NEW language. A fake that always replayed the original value
 * would have GET /me contradict the PATCH that just succeeded, and the provider would
 * correctly — but misleadingly — put the old language back.
 */
let storedProfile: MeDto = { ...PROFILE };

describe('LanguageProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    storedProfile = { ...PROFILE };
    vi.mocked(meApi.get).mockImplementation(async () => storedProfile);
    vi.mocked(meApi.updateLanguage).mockImplementation(async (language) => {
      storedProfile = { ...storedProfile, language };
      return storedProfile;
    });
  });

  afterEach(async () => {
    await i18n.changeLanguage('de');
    window.localStorage.clear();
  });

  it('keeps the document in step with the active language', async () => {
    renderWithProviders(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );

    await waitFor(() => expect(document.documentElement.lang).toBe('de'));
    expect(document.title).toBe('Wally — Meine Wand');
  });

  // The whole point of storing this on the profile: it has to beat whatever this device
  // happens to remember.
  it('lets the profile override a different locale stored on this device', async () => {
    writeStoredLocale('de');
    storedProfile = { ...PROFILE, language: 'en' };

    renderWithProviders(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('language')).toHaveTextContent('en'));
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Wally — My Board');
    // Mirrored back, so the next cold start opens in the right language with no flash.
    expect(window.localStorage.getItem('wally.language')).toBe('en');
  });

  it('switches optimistically and persists the choice', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('language')).toHaveTextContent('de'));

    await user.click(screen.getByRole('button', { name: 'to english' }));

    await waitFor(() => expect(screen.getByTestId('language')).toHaveTextContent('en'));
    expect(window.localStorage.getItem('wally.language')).toBe('en');
    expect(meApi.updateLanguage).toHaveBeenCalledWith('en');
  });

  it('rolls the switch back and says so when the save fails', async () => {
    vi.mocked(meApi.updateLanguage).mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderWithProviders(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('language')).toHaveTextContent('de'));

    await user.click(screen.getByRole('button', { name: 'to english' }));

    // Rolled back everywhere, so the UI never claims a language that was not saved.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByTestId('language')).toHaveTextContent('de');
    expect(window.localStorage.getItem('wally.language')).toBe('de');
  });

  it('does not ask for a profile before anyone is signed in', async () => {
    mockUseAuth.mockReturnValue({ status: 'unauthenticated' });

    renderWithProviders(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('language')).toHaveTextContent('de'));
    expect(meApi.get).not.toHaveBeenCalled();
  });
});
