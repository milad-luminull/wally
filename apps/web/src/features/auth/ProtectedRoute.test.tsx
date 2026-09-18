import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { renderWithProviders } from '@/test/renderWithProviders';
import { ProtectedRoute } from './ProtectedRoute';

const mockUseAuth = vi.fn();
vi.mock('./AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('./AuthProvider')>('./AuthProvider');
  return { ...actual, useAuth: () => mockUseAuth() };
});

function renderProtected(initialPath = '/boards/1') {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<div>Login-Seite</div>} />
      <Route path="/boards/:id" element={<ProtectedRoute>Geschützter Inhalt</ProtectedRoute>} />
    </Routes>,
    { route: initialPath },
  );
}

describe('ProtectedRoute', () => {
  it('shows a full-page skeleton while auth is loading, never the children', () => {
    mockUseAuth.mockReturnValue({ status: 'loading' });
    renderProtected();
    expect(screen.getByRole('status', { name: 'Lädt…' })).toBeInTheDocument();
    expect(screen.queryByText('Geschützter Inhalt')).not.toBeInTheDocument();
  });

  it('redirects to /login when unauthenticated', () => {
    mockUseAuth.mockReturnValue({ status: 'unauthenticated' });
    renderProtected();
    expect(screen.getByText('Login-Seite')).toBeInTheDocument();
  });

  it('renders children once authenticated', () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    renderProtected();
    expect(screen.getByText('Geschützter Inhalt')).toBeInTheDocument();
  });
});
