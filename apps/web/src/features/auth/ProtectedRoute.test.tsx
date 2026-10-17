import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ProtectedRoute } from './ProtectedRoute';

const mockUseAuth = vi.fn();
vi.mock('./AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('./AuthProvider')>('./AuthProvider');
  return { ...actual, useAuth: () => mockUseAuth() };
});

function LoginStub() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return <div>Login-Seite {from ?? 'ohne Rückweg'}</div>;
}

function renderProtected(initialPath = '/boards/1') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginStub />} />
      <Route path="/boards/:id" element={<ProtectedRoute>Geschützter Inhalt</ProtectedRoute>} />
    </Routes>,
    { route: initialPath },
  );
}

describe('ProtectedRoute', () => {
  it('shows a full-page skeleton while auth is loading, never the children', () => {
    mockUseAuth.mockReturnValue({ status: 'loading' });
    renderProtected();
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
    expect(screen.queryByText('Geschützter Inhalt')).not.toBeInTheDocument();
  });

  it('redirects to /login when unauthenticated, remembering where the visitor was going', () => {
    mockUseAuth.mockReturnValue({ status: 'unauthenticated', signedOut: false });
    renderProtected('/boards/1');
    expect(screen.getByText('Login-Seite /boards/1')).toBeInTheDocument();
  });

  // The board belonged to the account that just signed out. Handing it to whoever signs in
  // next sent them to a board they cannot see: a 404 straight after signing in.
  it('forgets the previous account’s board after a sign-out', () => {
    mockUseAuth.mockReturnValue({ status: 'unauthenticated', signedOut: true });
    renderProtected('/boards/1');
    expect(screen.getByText('Login-Seite ohne Rückweg')).toBeInTheDocument();
  });

  it('renders children once authenticated', () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    renderProtected();
    expect(screen.getByText('Geschützter Inhalt')).toBeInTheDocument();
  });
});
