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

const owner = boardAccess('OWNER', 'user-1', 'all');

const notes = [
  makeNote({
    id: 'n1',
    title: 'Today note',
    horizon: 'TODAY',
    priority: 'HIGH',
    dueDate: '2026-09-18',
  }),
  makeNote({
    id: 'n2',
    title: 'Week note',
    horizon: 'THIS_WEEK',
    priority: 'MEDIUM',
    dueDate: '2026-09-22',
  }),
  makeNote({
    id: 'n3',
    title: 'Another today note',
    horizon: 'TODAY',
    priority: 'LOW',
    dueDate: '2026-09-17',
  }),
];

describe('ListView', () => {
  it('groups notes by the active axis and hides empty groups (no "Later" group)', () => {
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

    // "Today" can also appear as a note's own due-date label when a fixture's dueDate is
    // today's real date, so this asserts the group header specifically: the "Today" text
    // immediately followed by its group's note count ("2": n1 + n3).
    const heuteHeader = screen
      .getAllByText('Today')
      .find((el) => el.nextElementSibling?.textContent === '2');
    expect(heuteHeader).toBeInTheDocument();
    expect(screen.getByText('This week')).toBeInTheDocument();
    expect(screen.queryByText('Later')).not.toBeInTheDocument();
  });

  it('shows the related count the board resolved for each row', () => {
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
        relatedCounts={new Map([['n2', 2]])}
      />,
    );
    expect(screen.getByText(/2 related/)).toBeInTheDocument();
    expect(screen.getAllByText(/related/)).toHaveLength(1);
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

    const titles = screen.getAllByText(/ note$/).map((el) => el.textContent);
    // "Another today note" is due 2026-09-17, before "Today note" (2026-09-18).
    expect(titles.indexOf('Another today note')).toBeLessThan(titles.indexOf('Today note'));
  });

  it('collapses to a single "All notes" group in free mode', () => {
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

    expect(screen.getByText('All notes')).toBeInTheDocument();
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

    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
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
    expect(screen.getByText('Your board is still empty')).toBeInTheDocument();
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
    expect(screen.getByText('No note matches the filter')).toBeInTheDocument();
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
    const row = await screen.findByRole('group', { name: 'Write a new note' });
    const firstGroup = screen.getByRole('heading', { name: 'Today' });
    expect(row.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    renderWithProviders(<ListView notes={[]} totalNoteCount={0} {...listProps} />);
    expect(await screen.findByRole('group', { name: 'Write a new note' })).toBeInTheDocument();
    expect(screen.queryByText('Your board is still empty')).not.toBeInTheDocument();
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
    const row = await screen.findByRole('group', { name: 'Write a new note' });
    const message = screen.getByText('No note matches the filter');
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
    const title = await screen.findByRole('textbox', { name: 'Title of the new note' });
    // Opens the text line without typing, so no note is created.
    await userEvent.setup().type(title, '{Shift>}{Enter}{/Shift}');
    expect(screen.getByRole('textbox', { name: 'Text of the new note' })).toHaveFocus();

    rerender(<ListView notes={notes} totalNoteCount={notes.length} {...listProps} />);
    expect(screen.getByRole('textbox', { name: 'Title of the new note' })).toBe(title);
    expect(screen.getByRole('textbox', { name: 'Text of the new note' })).toHaveFocus();
  });

  it('draws the answer card as the top row, above the groups', () => {
    renderWithProviders(
      <ListView
        notes={notes}
        totalNoteCount={notes.length}
        axis="horizon"
        currentUserId="user-1"
        onOpenNote={vi.fn()}
        onToggleDone={vi.fn()}
        access={owner}
        isBelowDesktop={false}
        ask={{ key: 1, placement: { kind: 'list' }, card: <div data-testid="answer" /> }}
      />,
    );
    const answer = screen.getByTestId('answer');
    expect(answer.parentElement).toHaveAttribute('data-ask');
    expect(answer.compareDocumentPosition(screen.getByText('Today note'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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
    expect(screen.getByText(/Moving notes freely works on a computer/)).toBeInTheDocument();
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
        makeNote({ id: 'shared', title: 'Shared note', visibility: 'SHARED', horizon: 'TODAY' }),
        makeNote({
          id: 'mine',
          title: 'My private note',
          visibility: 'PRIVATE',
          createdBy: { id: 'me', displayName: 'Me', email: 'me@example.com' },
          horizon: 'TODAY',
        }),
      ]);

      const checkboxOf = (title: string) =>
        within(screen.getByText(title).closest('[role="button"]') as HTMLElement).getByRole(
          'checkbox',
        );
      expect(checkboxOf('Shared note')).toBeDisabled();
      expect(checkboxOf('My private note')).toBeEnabled();
    });

    it('explains an empty board with the private-note copy', () => {
      renderViewerList([], 0);
      expect(
        screen.getByText('You can view this board. Notes you add here are private.'),
      ).toBeInTheDocument();
    });
  });

  it('marks a private row with a lock and leaves the assignee out of its meta line', () => {
    const me = { id: 'user-1', email: 'nora.falk@example.com', displayName: 'Nora Falk' };
    render(
      <ListView
        notes={[
          makeNote({ id: 'p1', title: 'Private draft', visibility: 'PRIVATE', assignee: me }),
          makeNote({ id: 's1', title: 'Shared draft', assignee: me }),
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

    const privateRow = screen.getByText('Private draft').closest('[role="button"]') as HTMLElement;
    expect(within(privateRow).getByRole('img', { name: 'Private note' })).toBeInTheDocument();
    expect(privateRow).not.toHaveTextContent('You');

    const sharedRow = screen.getByText('Shared draft').closest('[role="button"]') as HTMLElement;
    expect(within(sharedRow).queryByRole('img', { name: 'Private note' })).not.toBeInTheDocument();
    expect(sharedRow).toHaveTextContent('You');
  });
});
