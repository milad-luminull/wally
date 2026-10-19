import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  current: { status: 'unauthenticated', expired: null } as {
    status: string;
    expired: { unsaved: number } | null;
  },
}));
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => auth.current };
});

import { renderWithProviders } from '@/test/renderWithProviders';
vi.mock('@/i18n/LanguageProvider', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  // Since a user can have several boards, signing in leads to them, not to one board.
  it('invites the visitor to their boards', () => {
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(screen.getByText('Sign in to see your boards.')).toBeInTheDocument();
  });

  it('says the session ended, and how many unsaved changes could not be kept', () => {
    auth.current = { status: 'unauthenticated', expired: { unsaved: 2 } };
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your session ended, and 2 unsaved changes couldn’t be kept.',
    );
    auth.current = { status: 'unauthenticated', expired: null };
  });
});
