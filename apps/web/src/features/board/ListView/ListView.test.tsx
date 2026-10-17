import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeNote } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { boardAccess } from '../util/permissions';
import { ListView } from './ListView';

// The capture row reads the board's members for its person chips, and the language its
// date words are parsed in.
vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  membersApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/i18n/LanguageProvider', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/LanguageProvider')>('@/i18n/LanguageProvider');
  return {
    ...actual,
    useLanguage: () => ({
      language: 'de',
      setLanguage: vi.fn(),
      isSaving: false,
      saveFailed: false,
    }),
  };
});

const owner = boardAccess('OWNER', 'user-1', 'all');

const notes = [
  makeNote({
    id: 'n1',
    title: 'Heute-Notiz',
    horizon: 'HEUTE',
    priority: 'HOCH',
    dueDate: '2026-09-18',
  }),
  makeNote({
    id: 'n2',
    title: 'Woche-Notiz',
    horizon: 'DIESE_WOCHE',
    priority: 'MITTEL',
    dueDate: '2026-09-22',
  }),
  makeNote({
    id: 'n3',
    title: 'Weitere Heute-Notiz',
    horizon: 'HEUTE',
    priority: 'NIEDRIG',
    dueDate: '2026-09-17',
  }),
];

describe('ListView', () => {
  it('groups notes by the active axis and hides empty groups (no "Später" group)', () => {
    render(
      <ListView
        notes={notes}
        totalNoteCount={notes.length}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={owner}
        isBelowDesktop={false}
      />,
    );

    // "Heute" can also appear as a note's own due-date label when a fixture's dueDate is
    // today's real date, so this asserts the group header specifically: the "Heute" text
    // immediately followed by its group's note count ("2": n1 + n3).
    const heuteHeader = screen
      .getAllByText('Heute')
      .find((el) => el.nextElementSibling?.textContent === '2');
    expect(heuteHeader).toBeInTheDocument();
    expect(screen.getByText('Diese Woche')).toBeInTheDocument();
    expect(screen.queryByText('Später')).not.toBeInTheDocument();
  });

  it('sorts notes within a group by due date', () => {
    render(
      <ListView
        notes={notes}
        totalNoteCount={notes.length}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={owner}
        isBelowDesktop={false}
      />,
    );

    const titles = screen.getAllByText(/Notiz$/).map((el) => el.textContent);
    // "Weitere Heute-Notiz" is due 2026-09-17, before "Heute-Notiz" (2026-09-18).
    expect(titles.indexOf('Weitere Heute-Notiz')).toBeLessThan(titles.indexOf('Heute-Notiz'));
  });

  it('collapses to a single "Alle Notizen" group in Frei mode', () => {
    render(
      <ListView
        notes={notes}
        totalNoteCount={notes.length}
        axis="free"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={owner}
        isBelowDesktop={false}
      />,
    );

    expect(screen.getByText('Alle Notizen')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('groups by priority rows when axis is priority', () => {
    render(
      <ListView
        notes={notes}
        totalNoteCount={notes.length}
        axis="priority"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={owner}
        isBelowDesktop={false}
      />,
    );

    expect(screen.getByText('Hoch')).toBeInTheDocument();
    expect(screen.getByText('Mittel')).toBeInTheDocument();
    expect(screen.getByText('Niedrig')).toBeInTheDocument();
  });

  it('shows the empty-board message when there are no notes at all', () => {
    render(
      <ListView
        notes={[]}
        totalNoteCount={0}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={owner}
        isBelowDesktop={false}
      />,
    );
    expect(screen.getByText('Deine Wand ist noch leer')).toBeInTheDocument();
  });

  it('shows the filter-mismatch message when notes exist but the filter hides all of them', () => {
    render(
      <ListView
        notes={[]}
        totalNoteCount={3}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={owner}
        isBelowDesktop={false}
      />,
    );
    expect(screen.getByText('Keine Notiz passt zum Filter')).toBeInTheDocument();
  });

  it('writes a new note in a row above the first group, and in place of the empty state', async () => {
    const listProps = {
      axis: 'horizon',
      currentUserId: 'user-1',
      onOpenNote: vi.fn(),
      onToggleDone: vi.fn(),
      access: owner,
      isBelowDesktop: false,
      capture: { boardId: 'b1', visibility: 'SHARED', onDone: vi.fn() },
    } as const;
    const { unmount } = renderWithProviders(
      <ListView notes={notes} totalNoteCount={notes.length} {...listProps} />,
    );
    const row = await screen.findByRole('group', { name: 'Neue Notiz schreiben' });
    const firstGroup = screen.getByRole('heading', { name: 'Heute' });
    expect(row.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    renderWithProviders(<ListView notes={[]} totalNoteCount={0} {...listProps} />);
    expect(await screen.findByRole('group', { name: 'Neue Notiz schreiben' })).toBeInTheDocument();
    expect(screen.queryByText('Deine Wand ist noch leer')).not.toBeInTheDocument();
  });

  it('keeps the filter message above the capture row when a filter hides every note', async () => {
    renderWithProviders(
      <ListView
        notes={[]}
        totalNoteCount={3}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={owner}
        isBelowDesktop={false}
        capture={{ boardId: 'b1', visibility: 'SHARED', onDone: vi.fn() }}
      />,
    );
    const row = await screen.findByRole('group', { name: 'Neue Notiz schreiben' });
    const message = screen.getByText('Keine Notiz passt zum Filter');
    expect(message.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the capture row as it is when the first notes arrive under it', async () => {
    const listProps = {
      axis: 'horizon',
      currentUserId: 'user-1',
      onOpenNote: vi.fn(),
      onToggleDone: vi.fn(),
      access: owner,
      isBelowDesktop: false,
      capture: { id: 1, boardId: 'b1', visibility: 'SHARED', onDone: vi.fn() },
    } as const;
    const { rerender } = renderWithProviders(
      <ListView notes={[]} totalNoteCount={0} {...listProps} />,
    );
    const title = await screen.findByRole('textbox', { name: 'Titel der neuen Notiz' });
    // Opens the text line without typing, so no note is created.
    await userEvent.setup().type(title, '{Shift>}{Enter}{/Shift}');
    expect(screen.getByRole('textbox', { name: 'Text der neuen Notiz' })).toHaveFocus();

    rerender(<ListView notes={notes} totalNoteCount={notes.length} {...listProps} />);
    expect(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' })).toBe(title);
    expect(screen.getByRole('textbox', { name: 'Text der neuen Notiz' })).toHaveFocus();
  });

  it('shows the mobile drag hint below desktop width', () => {
    render(
      <ListView
        notes={notes}
        totalNoteCount={notes.length}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={owner}
        isBelowDesktop
      />,
    );
    expect(screen.getByText(/Notizen frei verschieben geht am Rechner/)).toBeInTheDocument();
  });

  describe('as a viewer', () => {
    const viewer = boardAccess('VIEW', 'me', 'all');

    function renderViewerList(listNotes: typeof notes, totalNoteCount = listNotes.length) {
      render(
        <ListView
          notes={listNotes}
          totalNoteCount={totalNoteCount}
          axis="horizon"
          currentUserId="me"
          onOpenNote={vi.fn()}
          onToggleDone={vi.fn()}
          access={viewer}
          isBelowDesktop={false}
        />,
      );
    }

    it('can only tick off their own private notes', () => {
      renderViewerList([
        makeNote({ id: 'shared', title: 'Geteilte Notiz', visibility: 'SHARED', horizon: 'HEUTE' }),
        makeNote({
          id: 'mine',
          title: 'Meine private Notiz',
          visibility: 'PRIVATE',
          createdBy: { id: 'me', displayName: 'Ich', email: 'ich@example.com' },
          horizon: 'HEUTE',
        }),
      ]);

      const checkboxOf = (title: string) =>
        within(screen.getByText(title).closest('[role="button"]') as HTMLElement).getByRole(
          'checkbox',
        );
      expect(checkboxOf('Geteilte Notiz')).toBeDisabled();
      expect(checkboxOf('Meine private Notiz')).toBeEnabled();
    });

    it('explains an empty board with the private-note copy', () => {
      renderViewerList([], 0);
      expect(
        screen.getByText(
          'Du kannst diese Wand ansehen. Notizen, die du hier anlegst, sind privat.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('marks a private row with a lock and leaves the assignee out of its meta line', () => {
    const me = { id: 'user-1', email: 'nora.falk@example.com', displayName: 'Nora Falk' };
    render(
      <ListView
        notes={[
          makeNote({ id: 'p1', title: 'Privat-Notiz', visibility: 'PRIVATE', assignee: me }),
          makeNote({ id: 's1', title: 'Geteilt-Notiz', assignee: me }),
        ]}
        totalNoteCount={2}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={owner}
        isBelowDesktop={false}
      />,
    );

    const privateRow = screen.getByText('Privat-Notiz').closest('[role="button"]') as HTMLElement;
    expect(within(privateRow).getByRole('img', { name: 'Private Notiz' })).toBeInTheDocument();
    expect(privateRow).not.toHaveTextContent('Du');

    const sharedRow = screen.getByText('Geteilt-Notiz').closest('[role="button"]') as HTMLElement;
    expect(within(sharedRow).queryByRole('img', { name: 'Private Notiz' })).not.toBeInTheDocument();
    expect(sharedRow).toHaveTextContent('Du');
  });
});
