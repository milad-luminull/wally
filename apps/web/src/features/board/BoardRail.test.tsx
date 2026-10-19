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

it('collapses and expands without losing navigation, capture or keyboard focus', () => {
  const onSetAxis = vi.fn();
  const onNewNote = vi.fn();
  renderWithProviders(
    <BoardRail
      boardId="b"
      boardName="My board"
      axis="priority"
      onSetAxis={onSetAxis}
      onNewNote={onNewNote}
      newNoteVisibility="SHARED"
    />,
  );
  const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
  toggle.focus();
  fireEvent.click(toggle);
  const expand = screen.getByRole('button', { name: 'Expand sidebar' });
  expect(expand).toHaveFocus();
  expect(expand).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: 'Priority' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboard' }));
  expect(onSetAxis).toHaveBeenCalledWith('free');
  fireEvent.click(screen.getByRole('button', { name: 'New note' }));
  expect(onNewNote).toHaveBeenCalledTimes(1);
  fireEvent.click(expand);
  expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(screen.getByRole('link', { name: 'To your boards' })).toHaveAttribute('href', '/boards');
});
