import { expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
vi.mock('./AccountMenu', () => ({ AccountMenu: () => null }));
vi.mock('./BoardSwitcher', () => ({ BoardSwitcher: () => null }));
import { BoardRail } from './BoardRail';
it('changes only grouping, leaving the independently selected layout alone', () => {
  const onSetAxis = vi.fn();
  renderWithProviders(
    <BoardRail
      boardId="b"
      boardName="My board"
      axis="horizon"
      onSetAxis={onSetAxis}
      onNewNote={vi.fn()}
      newNoteVisibility="SHARED"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'This Week' }));
  expect(onSetAxis).toHaveBeenCalledWith('horizon');
  fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
  expect(onSetAxis).toHaveBeenCalledWith('priority');
  expect(screen.queryByRole('button', { name: 'List' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'This Week' })).toHaveAttribute('aria-current', 'page');
});
it('retains the private capture action and selected wall state', () => {
  const onNewNote = vi.fn();
  renderWithProviders(
    <BoardRail
      boardId="b"
      boardName="My board"
      axis="free"
      onSetAxis={vi.fn()}
      onNewNote={onNewNote}
      newNoteVisibility="PRIVATE"
    />,
  );
  expect(screen.getByRole('button', { name: 'Whiteboard' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  fireEvent.click(screen.getByRole('button', { name: 'New private note' }));
  expect(onNewNote).toHaveBeenCalledTimes(1);
});
