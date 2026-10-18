import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
const auth = vi.hoisted(() => ({ status: 'unauthenticated' }));
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('@/i18n/LanguageProvider', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));
vi.mock('./LandingPage', () => ({ LandingPage: () => <div>Existing board resolver</div> }));
import { HomePage } from './HomePage';
it('offers login and signup to signed-out visitors', () => {
  auth.status = 'unauthenticated';
  renderWithProviders(<HomePage />);
  expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  expect(screen.getAllByRole('link', { name: 'Start your wall' })[0]).toHaveAttribute(
    'href',
    '/signup',
  );
});
it('keeps the existing authenticated board resolver', () => {
  auth.status = 'authenticated';
  renderWithProviders(<HomePage />);
  expect(screen.getByText('Existing board resolver')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
});
it('does not flash marketing while authentication resolves', () => {
  auth.status = 'loading';
  renderWithProviders(<HomePage />);
  expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  expect(screen.queryByText('Existing board resolver')).not.toBeInTheDocument();
});
