import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
const auth = vi.hoisted(() => ({ status: 'unauthenticated' }));
vi.mock('@/features/auth/AuthProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/AuthProvider')>()),
  useAuth: () => auth,
}));
vi.mock('@/i18n/LanguageProvider', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));
vi.mock('@/lib/resources', () => ({ boardsApi: { list: vi.fn().mockResolvedValue([]) } }));
import { HomePage } from './HomePage';

it('keeps the landing and signup entry points available to visitors', () => {
  auth.status = 'unauthenticated';
  renderWithProviders(<HomePage />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Get it out of your head.');
  expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  for (const link of screen.getAllByRole('link', { name: 'Start your wall' })) {
    expect(link).toHaveAttribute('href', '/signup');
  }
});

it('offers the boards from every landing CTA when already signed in', () => {
  auth.status = 'authenticated';
  renderWithProviders(<HomePage />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Get it out of your head.');
  expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Start your wall' })).not.toBeInTheDocument();
  const links = screen.getAllByRole('link', { name: 'Open Wally' });
  expect(links).toHaveLength(3);
  for (const link of links) expect(link).toHaveAttribute('href', '/boards');
});

it('waits for auth resolution before offering login or signup, then updates in place', () => {
  auth.status = 'loading';
  const { rerender } = renderWithProviders(<HomePage />);
  expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Start your wall' })).not.toBeInTheDocument();
  auth.status = 'authenticated';
  rerender(<HomePage />);
  expect(screen.getAllByRole('link', { name: 'Open Wally' })).toHaveLength(3);
});
