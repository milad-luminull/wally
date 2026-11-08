import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUseLanguage = vi.fn();
vi.mock('@/i18n/languageContext', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/languageContext')>('@/i18n/languageContext');
  return { ...actual, useLanguage: () => mockUseLanguage() };
});

import { Label } from '@/components/ui/label';
import { renderWithProviders } from '@/test/renderWithProviders';
import { LanguageSelect } from './LanguageSelect';

let setLanguage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setLanguage = vi.fn();
  mockUseLanguage.mockReturnValue({
    language: 'en',
    setLanguage,
    isSaving: false,
    saveFailed: false,
  });
});

function renderSelect() {
  renderWithProviders(
    <>
      <Label htmlFor="language">Language</Label>
      <LanguageSelect id="language" />
    </>,
  );
}

it('shows the active language under its label', () => {
  renderSelect();
  // getByLabelText, not a test id: the label association is the accessibility contract.
  expect(screen.getByLabelText('Language')).toHaveTextContent('English');
});

/**
 * Longer timeout than the 20s default: Radix's select in jsdom is slow in this repo, and it
 * tipped over the default inside the container (see the popover suites' runtimes).
 */
it('switches language', async () => {
  const user = userEvent.setup();
  renderSelect();
  await user.click(screen.getByLabelText('Language'));
  // Endonyms are never translated, so a user stranded in the wrong language can still
  // recognise their own.
  await user.click(await screen.findByRole('option', { name: 'Deutsch' }));
  expect(setLanguage).toHaveBeenCalledWith('de');
}, 60_000);

it('announces a failed save rather than silently reverting', () => {
  mockUseLanguage.mockReturnValue({
    language: 'en',
    setLanguage,
    isSaving: false,
    saveFailed: true,
  });
  renderSelect();
  expect(screen.getByRole('status')).toHaveTextContent('Couldn’t save your language');
});
