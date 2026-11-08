import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

vi.mock('@/i18n/languageContext', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/languageContext')>('@/i18n/languageContext');
  return {
    ...actual,
    useLanguage: () => ({
      language: 'en',
      setLanguage: vi.fn(),
      isSaving: false,
      saveFailed: false,
    }),
  };
});

import { renderWithProviders } from '@/test/renderWithProviders';
import { LanguageSettings } from './LanguageSettings';

it('shows the active language under the section title', () => {
  renderWithProviders(<LanguageSettings />);
  expect(screen.getByRole('heading', { level: 1, name: 'Language' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('English');
});
