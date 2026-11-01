import { beforeEach, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';

const auth = vi.hoisted(() => ({
  status: 'unauthenticated',
  listeners: new Set<() => void>(),
  hostedLogin: vi.fn(),
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
  auth.hostedLogin.mockReset().mockResolvedValue(undefined);
});

/** The hosted login page signed the person in; the app learns it from the session. */
async function finishHostedLogin() {
  await act(async () => {
    auth.status = 'authenticated';
    for (const notify of auth.listeners) notify();
  });
}

it.each(['/login', '/signup'])(
  '%s takes an existing session into its board instead of back to marketing',
  async (route) => {
    auth.status = 'authenticated';
    renderEntry(route);
    expect(await screen.findByText('Destination: /boards/own')).toBeInTheDocument();
  },
);

it.each([
  ['/login', 'Continue to sign in', false],
  ['/signup', 'Continue to create account', true],
])(
  '%s hands the invitation to hosted login and offers no password form',
  async (route, label, signup) => {
    const user = userEvent.setup();
    renderEntry(route, { from: '/share/invitation-token' });
    expect(screen.queryByLabelText('Password', { exact: true })).toBeNull();
    await user.click(screen.getByRole('button', { name: label }));
    expect(auth.hostedLogin).toHaveBeenCalledWith(signup, '/share/invitation-token');
  },
);

it('takes a visitor from the public root to hosted login', async () => {
  const user = userEvent.setup();
  renderEntry('/');
  await user.click(screen.getByRole('link', { name: 'Log in' }));
  await user.click(screen.getByRole('button', { name: 'Continue to sign in' }));
  expect(auth.hostedLogin).toHaveBeenCalledWith(false, null);
});

it.each(['/login', '/signup'])(
  '%s keeps the invitation while authentication is waiting for its token',
  async (route) => {
    renderEntry(route, { from: '/share/delayed-token' });
    await finishHostedLogin();
    expect(await screen.findByText('Destination: /share/delayed-token')).toBeInTheDocument();
  },
);
