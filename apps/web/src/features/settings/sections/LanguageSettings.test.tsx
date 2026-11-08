import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

const language = vi.hoisted(() => ({ saveFailed: false }));
vi.mock('@/i18n/languageContext', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/languageContext')>('@/i18n/languageContext');
  return {
    ...actual,
    useLanguage: () => ({
      language: 'en',
      setLanguage: vi.fn(),
      isSaving: false,
      saveFailed: language.saveFailed,
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

it('says when the language could not be saved, under the label so the select stays centred', () => {
  language.saveFailed = true;
  renderWithProviders(<LanguageSettings />);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Couldn’t save your language');
  expect(status.closest('.setting-row-control')).toBeNull();
  language.saveFailed = false;
});
