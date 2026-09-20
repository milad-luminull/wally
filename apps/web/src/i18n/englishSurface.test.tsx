import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { ListView } from '@/features/board/ListView/ListView';
import { i18n } from './index';
import { de } from './de';
import { en } from './en';

/**
 * The rest of the suite renders in German, which means the English catalogue is only ever
 * checked structurally (resources.test.ts) and never actually rendered. These are the few
 * assertions that put it on screen.
 */
beforeEach(async () => {
  // Awaited BEFORE render, so the switch is settled and React sees one consistent tree.
  await i18n.changeLanguage('en');
});

// No afterEach reset here: src/test/setup.ts already resets the language, and it does so
// AFTER RTL's cleanup. Switching before unmount re-renders the live tree outside act().

describe('the English surface', () => {
  it('renders board copy in English', () => {
    const notes = [makeNote({ id: 'n1', title: 'Ship it', horizon: 'HEUTE', priority: 'HOCH' })];

    renderWithProviders(
      <ListView
        notes={notes}
        totalNoteCount={notes.length}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        canEdit
        isBelowDesktop={false}
      />,
    );

    // "Today" is also a note's own due-date label when the fixture is due today, so this
    // pins the group header specifically: the text immediately followed by its count.
    const header = screen
      .getAllByText('Today')
      .find((el) => el.nextElementSibling?.textContent === '1');
    expect(header).toBeInTheDocument();
    expect(screen.queryByText('Heute')).not.toBeInTheDocument();
  });

  it('renders the empty state in English', () => {
    renderWithProviders(
      <ListView
        notes={[]}
        totalNoteCount={0}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        canEdit
        isBelowDesktop={false}
      />,
    );

    expect(screen.getByText('Your board is still empty')).toBeInTheDocument();
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
