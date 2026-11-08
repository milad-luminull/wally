import { beforeEach, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';

const breakpoint = { isDesktop: true };
vi.mock('@/lib/useBreakpoint', () => ({
  useBreakpoint: () => ({ isDesktop: breakpoint.isDesktop, isBelowDesktop: !breakpoint.isDesktop }),
}));
const signOut = vi.fn();
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return {
    ...actual,
    useAuth: () => ({
      user: { displayName: 'Mika Brandt', email: 'mika@example.com' },
      emailVerified: true,
      signOut,
      refreshUser: vi.fn(),
    }),
  };
});
// The section views have suites of their own; here each is just its title.
vi.mock('@/features/settings/sectionViews', async () => {
  const { SettingsSection } = await vi.importActual<
    typeof import('@/features/settings/SettingsSection')
  >('@/features/settings/SettingsSection');
  const view = (id: 'appearance' | 'language' | 'wallybot' | 'connections' | 'account') => () => (
    <SettingsSection id={id}>{null}</SettingsSection>
  );
  return {
    SECTION_VIEWS: {
      appearance: view('appearance'),
      language: view('language'),
      wallybot: view('wallybot'),
      connections: view('connections'),
      account: view('account'),
    },
  };
});

import { renderWithProviders } from '@/test/renderWithProviders';
import { SettingsPage } from './SettingsPage';

function Probe() {
  const location = useLocation();
  return <p>landed {location.pathname + location.search + location.hash}</p>;
}

function LocationText() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderSettings(route: string, state?: unknown) {
  const from = (state as { from?: string } | undefined)?.from;
  return renderWithProviders(
    <Routes>
      <Route
        path="/settings"
        element={
          <>
            <SettingsPage />
            <LocationText />
          </>
        }
      />
      <Route
        path="/settings/:section"
        element={
          <>
            <SettingsPage />
            <LocationText />
          </>
        }
      />
      <Route path="*" element={<Probe />} />
    </Routes>,
    { route, state, before: from ? [from] : [] },
  );
}

beforeEach(() => {
  breakpoint.isDesktop = true;
  signOut.mockReset();
});

it('opens Appearance on a wide screen, with the five sections in the rail', async () => {
  renderSettings('/settings');
  expect(await screen.findByRole('heading', { level: 1, name: 'Appearance' })).toBeInTheDocument();
  expect(screen.getByTestId('path')).toHaveTextContent('/settings/appearance');
  expect(
    screen.getByText('Colours, light or dark, and the canvas background.'),
  ).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Settings' });
  const links = within(nav).getAllByRole('link');
  expect(links.map((l) => l.textContent)).toEqual([
    'Appearance',
    'Language',
    'Wallybot',
    'Connected apps',
    'Account and data',
  ]);
  expect(within(nav).getByRole('link', { name: 'Appearance' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

it('switches sections and still goes back to where Settings was opened', async () => {
  const user = userEvent.setup();
  renderSettings('/settings/account', { from: '/boards/b1?view=list' });
  await user.click(screen.getByRole('link', { name: 'Language' }));
  expect(screen.getByRole('heading', { level: 1, name: 'Language' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('landed /boards/b1?view=list')).toBeInTheDocument();
});

it('goes back to the board home when it does not know the origin', async () => {
  const user = userEvent.setup();
  renderSettings('/settings/language');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('landed /boards')).toBeInTheDocument();
});

it('sends an unknown section to Appearance on a wide screen, keeping the origin', async () => {
  const user = userEvent.setup();
  renderSettings('/settings/nope', { from: '/boards/b1' });
  expect(await screen.findByRole('heading', { level: 1, name: 'Appearance' })).toBeInTheDocument();
  expect(screen.getByTestId('path')).toHaveTextContent('/settings/appearance');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('landed /boards/b1')).toBeInTheDocument();
});

it('sends an unknown section to the list on a narrow screen', async () => {
  breakpoint.isDesktop = false;
  renderSettings('/settings/nope');
  expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByTestId('path')).toHaveTextContent(/^\/settings$/);
});

it('shows the list on a narrow screen, then a section, then the list again', async () => {
  breakpoint.isDesktop = false;
  const user = userEvent.setup();
  renderSettings('/settings', { from: '/boards/b1' });
  expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Settings' })).toBeInTheDocument();
  for (const description of [
    'Colours, light or dark, and the canvas background.',
    'The language Wally uses.',
    'Whether suggestions apply on their own or wait for you.',
    'Let ChatGPT, Claude or other AI apps use your boards.',
    'Download your data or delete your account.',
  ]) {
    expect(screen.getByText(description)).toBeInTheDocument();
  }
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Language/ }));
  expect(screen.getByRole('heading', { level: 1, name: 'Language' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back to settings' }));
  expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('landed /boards/b1')).toBeInTheDocument();
});

it('returns to the list, not out of the app, from a section opened directly on a phone', async () => {
  breakpoint.isDesktop = false;
  const user = userEvent.setup();
  renderSettings('/settings/account');
  await user.click(screen.getByRole('button', { name: 'Back to settings' }));
  expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByTestId('path')).toHaveTextContent(/^\/settings$/);
});

it('shows who is signed in and signs out', async () => {
  const user = userEvent.setup();
  renderSettings('/settings/appearance');
  expect(screen.getByText('Mika Brandt')).toBeInTheDocument();
  expect(screen.getByText('mika@example.com')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(signOut).toHaveBeenCalledTimes(1);
});

it('moves focus to the new page title on a narrow screen', async () => {
  breakpoint.isDesktop = false;
  const user = userEvent.setup();
  renderSettings('/settings', { from: '/boards/b1' });
  await user.click(screen.getByRole('button', { name: /^Language/ }));
  expect(screen.getByRole('heading', { level: 1, name: 'Language' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Back to settings' }));
  expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toHaveFocus();
});

it('keeps the origin when the window crosses the desktop breakpoint', async () => {
  breakpoint.isDesktop = false;
  const user = userEvent.setup();
  const { rerender } = renderSettings('/settings', { from: '/boards/b1' });
  expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  breakpoint.isDesktop = true;
  rerender(<></>);
  rerender(
    <Routes>
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/settings/:section" element={<SettingsPage />} />
      <Route path="*" element={<Probe />} />
    </Routes>,
  );
  expect(await screen.findByRole('heading', { level: 1, name: 'Appearance' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('landed /boards/b1')).toBeInTheDocument();
});
