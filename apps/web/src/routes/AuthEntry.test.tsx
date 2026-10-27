import { beforeEach, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';

const auth = vi.hoisted(() => ({
  status: 'unauthenticated',
  listeners: new Set<() => void>(),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
}));
vi.mock('@/features/auth/AuthProvider', async (importOriginal) => {
  const { useSyncExternalStore } = await import('react');
  return {
    ...(await importOriginal<typeof import('@/features/auth/AuthProvider')>()),
    useAuth: () => {
      useSyncExternalStore(
        (notify) => {
          auth.listeners.add(notify);
          return () => {
            auth.listeners.delete(notify);
          };
        },
        () => auth.status,
      );
      return auth;
    },
  };
});
vi.mock('@/i18n/languageContext', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));
vi.mock('@/lib/resources', () => ({
  boardsApi: {
    list: vi.fn().mockResolvedValue([{ id: 'own', name: 'My board', currentUserRole: 'OWNER' }]),
  },
}));
import { HomePage } from './HomePage';
import { LoginPage } from './LoginPage';
import { SignupPage } from './SignupPage';
import { BoardEntryPage } from './BoardEntryPage';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';

function Destination() {
  const location = useLocation();
  return <p>Destination: {location.pathname + location.search}</p>;
}

function renderEntry(route: string, state?: unknown) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <BoardEntryPage />
          </ProtectedRoute>
        }
      />
      <Route path="/boards/:boardId" element={<Destination />} />
      <Route path="/share/:token" element={<Destination />} />
    </Routes>,
    { route, state },
  );
}

beforeEach(() => {
  auth.status = 'unauthenticated';
  for (const signIn of [auth.signInWithEmail, auth.signUpWithEmail, auth.signInWithGoogle]) {
    signIn.mockReset().mockImplementation(async () => {
      auth.status = 'authenticated';
      for (const notify of auth.listeners) notify();
    });
  }
});

it.each(['/login', '/signup'])(
  '%s takes an existing session into its board instead of back to marketing',
  async (route) => {
    auth.status = 'authenticated';
    renderEntry(route);
    expect(await screen.findByText('Destination: /boards/own')).toBeInTheDocument();
  },
);

it.each(['/login', '/signup'])(
  '%s preserves an invitation through successful Google authentication',
  async (route) => {
    const user = userEvent.setup();
    renderEntry(route, { from: '/share/invitation-token' });
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText('Destination: /share/invitation-token')).toBeInTheDocument();
  },
);

it('takes an email login from the public root into the user’s board', async () => {
  const user = userEvent.setup();
  renderEntry('/');
  await user.click(screen.getByRole('link', { name: 'Log in' }));
  await user.type(screen.getByLabelText('Email'), 'visitor@example.test');
  await user.type(screen.getByLabelText('Password', { exact: true }), 'test-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Destination: /boards/own')).toBeInTheDocument();
});

it.each(['/login', '/signup'])(
  '%s keeps the invitation while authentication is waiting for its token',
  async (route) => {
    const user = userEvent.setup();
    auth.signInWithGoogle.mockResolvedValue(undefined);
    renderEntry(route, { from: '/share/delayed-token' });
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await act(async () => {
      auth.status = 'authenticated';
      for (const notify of auth.listeners) notify();
    });
    expect(await screen.findByText('Destination: /share/delayed-token')).toBeInTheDocument();
  },
);
