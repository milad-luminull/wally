import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';

const mockUseAuth = vi.fn();
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => mockUseAuth() };
});

const mockUseLanguage = vi.fn();
vi.mock('@/i18n/languageContext', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/languageContext')>('@/i18n/languageContext');
  return { ...actual, useLanguage: () => mockUseLanguage() };
});

const mockUseWallybotPreferences = vi.fn();
vi.mock('@/lib/preferences', async () => {
  const actual = await vi.importActual<typeof import('@/lib/preferences')>('@/lib/preferences');
  return { ...actual, useWallybotPreferences: () => mockUseWallybotPreferences() };
});

import { renderWithProviders } from '@/test/renderWithProviders';
import { AccountMenu } from './AccountMenu';

function LocationProbe() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '';
  return (
    <p>
      at {location.pathname} from {from}
    </p>
  );
}

describe('AccountMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { displayName: 'Mika Brandt', email: 'mika@example.com' },
      signOut: vi.fn(),
    });
    mockUseLanguage.mockReturnValue({
      language: 'en',
      setLanguage: vi.fn(),
      isSaving: false,
      saveFailed: false,
    });
    mockUseWallybotPreferences.mockReturnValue([{ autoApply: true }, vi.fn()]);
  });

  async function openMenu() {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AccountMenu />
        <LocationProbe />
      </>,
      { route: '/boards/b1?view=list' },
    );
    await user.click(screen.getByRole('button', { name: 'Profile & preferences' }));
    return user;
  }

  it('keeps the light and dark switch, and leads to Settings for the rest', async () => {
    await openMenu();
    const mode = screen.getByRole('group', { name: 'Mode' });
    for (const name of ['System', 'Light', 'Dark']) {
      expect(within(mode).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByLabelText('Colour palette')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Language')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Connected apps' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Account and data' })).not.toBeInTheDocument();
  });

  it('puts Settings first, before shortcuts and sign out', async () => {
    await openMenu();
    const items = screen
      .getAllByRole('link')
      .concat(screen.getAllByRole('button').filter((b) => !b.closest('[role="group"]')))
      .filter((el) => el.closest('[data-radix-popper-content-wrapper]'))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map((el) => el.textContent?.trim());
    expect(items[0]).toBe('Settings');
    expect(items.slice(1)).toEqual(['Keyboard shortcuts?', 'Sign out']);
  });

  it('opens Settings remembering the board it was opened from', async () => {
    const user = await openMenu();
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.getByText('at /settings from /boards/b1?view=list')).toBeInTheDocument();
  });
});
