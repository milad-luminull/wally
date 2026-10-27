import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { ListView } from '@/features/board/ListView/ListView';
import { boardAccess } from '@/features/board/util/permissions';
import { i18n } from './index';
import { de } from './de';
import { en } from './en';

// No LanguageProvider here (it would fetch /me); useLanguage answers what the provider would,
// the active i18n language, which the rows and property editor sort by.
vi.mock('@/i18n/languageContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/languageContext')>();
  const { i18n } = await import('@/i18n');
  const { FALLBACK_LOCALE, normalizeLocale } = await import('@/i18n/locales');
  return {
    ...actual,
    useLanguage: () => ({
      language: normalizeLocale(i18n.language) ?? FALLBACK_LOCALE,
      setLanguage: () => {},
      isSaving: false,
      saveFailed: false,
    }),
  };
});

/**
 * The rest of the suite renders in English (ADR-0014), which means the German catalogue, the
 * product's default language, is otherwise only checked structurally (resources.test.ts) and
 * never actually rendered. These are the few assertions that put it on screen.
 */
beforeEach(async () => {
  // Awaited BEFORE render, so the switch is settled and React sees one consistent tree.
  await i18n.changeLanguage('de');
});

// No afterEach reset here: src/test/setup.ts already resets the language, and it does so
// AFTER RTL's cleanup. Switching before unmount re-renders the live tree outside act().

describe('the German surface', () => {
  it('renders board copy in German', () => {
    const notes = [makeNote({ id: 'n1', title: 'Ship it', horizon: 'TODAY', priority: 'HIGH' })];

    renderWithProviders(
      <ListView
        notes={notes}
        totalNoteCount={notes.length}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={boardAccess('OWNER', 'user-1', 'all')}
        isBelowDesktop={false}
      />,
    );

    // "Heute" is also a note's own due-date label when the fixture is due today, so this
    // pins the group header specifically: the text immediately followed by its count.
    const header = screen
      .getAllByText('Heute')
      .find((el) => el.nextElementSibling?.textContent === '1');
    expect(header).toBeInTheDocument();
    expect(screen.queryByText('Today')).not.toBeInTheDocument();
  });

  it('renders the empty state in German', () => {
    renderWithProviders(
      <ListView
        notes={[]}
        totalNoteCount={0}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={boardAccess('OWNER', 'user-1', 'all')}
        isBelowDesktop={false}
      />,
    );

    expect(screen.getByText('Deine Wand ist noch leer')).toBeInTheDocument();
  });

  /**
   * ZoneBands carries a standing constraint: its add-note label must not contain the top
   * bar's own "new note" phrase, because the suites (and the e2e specs) match accessible
   * names by SUBSTRING — a collision makes `getByRole('button', { name: … })` ambiguous.
   *
   * That was only ever enforced by a comment in the German source. Asserting it per locale
   * is what stops a future translation quietly reintroducing the ambiguity.
   */
  it.each([
    ['de', de],
    ['en', en],
  ])('keeps the zone add-note label distinct from the top bar in %s', (_locale, catalogue) => {
    expect(catalogue.board.zone.addNote).not.toContain(catalogue.board.topBar.newNote);
  });
});
