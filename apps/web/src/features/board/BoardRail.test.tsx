import { expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
vi.mock('./AccountMenu', () => ({ AccountMenu: () => null }));
vi.mock('./BoardSwitcher', () => ({ BoardSwitcher: () => null }));
import { BoardRail } from './BoardRail';
it('opens existing wall modes with one atomic view/axis selection', () => {
  const onSetLayout = vi.fn();
  renderWithProviders(
    <BoardRail
      boardId="b"
      boardName="My board"
      view="list"
      axis="horizon"
      onSetLayout={onSetLayout}
      onNewNote={vi.fn()}
      newNoteVisibility="SHARED"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
  expect(onSetLayout).toHaveBeenCalledWith('wand', 'priority');
  fireEvent.click(screen.getByRole('button', { name: 'List' }));
  expect(onSetLayout).toHaveBeenLastCalledWith('list', 'horizon');
});
it('retains the private capture action and selected wall state', () => {
  const onNewNote = vi.fn();
  renderWithProviders(
    <BoardRail
      boardId="b"
      boardName="My board"
      view="wand"
      axis="free"
      onSetLayout={vi.fn()}
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
