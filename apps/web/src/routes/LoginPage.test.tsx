import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => ({ status: 'unauthenticated' }) };
});

import { renderWithProviders } from '@/test/renderWithProviders';
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  // Since a user can have several boards, signing in leads to them, not to one board.
  it('invites the visitor to their boards', () => {
    renderWithProviders(<LoginPage />, { route: '/login' });
    expect(screen.getByText('Sign in to see your boards.')).toBeInTheDocument();
  });
});
