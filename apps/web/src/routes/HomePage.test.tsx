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

it.each(['unauthenticated', 'authenticated', 'loading'])(
  'keeps the public landing and auth entry points visible when auth is %s',
  (status) => {
    auth.status = status;
    renderWithProviders(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Get it out of your head.');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
    for (const link of screen.getAllByRole('link', { name: 'Start your wall' })) {
      expect(link).toHaveAttribute('href', '/signup');
    }
  },
);
