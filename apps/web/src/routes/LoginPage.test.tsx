import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  current: { status: 'unauthenticated', expired: null, signedOut: false } as {
    status: string;
    expired: { unsaved: number } | null;
    signedOut: boolean;
  },
}));
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => auth.current };
});

import { renderWithProviders } from '@/test/renderWithProviders';
vi.mock('@/i18n/languageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  // Since a user can have several boards, signing in leads to them, not to one board.
  it('invites the visitor to their boards', () => {
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(screen.getByText('Sign in to see your boards.')).toBeInTheDocument();
  });

  // Google sign-in creates an account from this page too, so it states the Terms apply.
  it('links the terms and the privacy policy that continuing accepts', () => {
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('says the session ended, and how many unsaved changes could not be kept', () => {
    auth.current = { status: 'unauthenticated', expired: { unsaved: 2 }, signedOut: false };
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your session ended, and 2 unsaved changes couldn’t be kept.',
    );
    auth.current = { status: 'unauthenticated', expired: null, signedOut: false };
  });

  it('confirms a deleted account once, then forgets it', () => {
    sessionStorage.setItem('wally.accountDeleted', '1');
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(screen.getByRole('status')).toHaveTextContent('Your account is deleted.');
    expect(sessionStorage.getItem('wally.accountDeleted')).toBeNull();
  });

  // Signing out sets the status first, so the protected route shows /login before the browser
  // leaves for Auth0's logout. That page must keep the flag for the page Auth0 returns to.
  it('keeps the deleted flag while the sign-out is still on its way to Auth0', () => {
    sessionStorage.setItem('wally.accountDeleted', '1');
    auth.current = { status: 'unauthenticated', expired: null, signedOut: true };
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(sessionStorage.getItem('wally.accountDeleted')).toBe('1');
    auth.current = { status: 'unauthenticated', expired: null, signedOut: false };
    sessionStorage.removeItem('wally.accountDeleted');
  });
});
