import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { boardAccess } from '../util/permissions';
import { WandView } from './WandView';

// The free canvas reads its backdrop from the profile; signed out, that query never runs.
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => ({ status: 'unauthenticated', user: null }) };
});

vi.mock('@/lib/resources', () => ({
  notesApi: { create: vi.fn(), list: vi.fn(), move: vi.fn() },
  meApi: { get: vi.fn(), update: vi.fn() },
}));

import { notesApi } from '@/lib/resources';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(notesApi.create).mockResolvedValue(makeNote({ id: 'created' }));
  vi.mocked(notesApi.list).mockResolvedValue([]);
});

function renderWall(axis: 'horizon' | 'priority' | 'free', access: ReturnType<typeof boardAccess>) {
  const notes = [makeNote({ id: 'n1', title: 'Vorhanden', horizon: 'HEUTE', priority: 'HOCH' })];
  return renderWithProviders(
    <WandView
      boardId="board-1"
      notes={notes}
      totalNoteCount={notes.length}
      currentUserId="me"
      axis={axis}
      selectedNoteId={null}
      onOpenNote={vi.fn()}
      onDuplicateNote={vi.fn()}
      access={access}
    />,
  );
}

/** A double-click on the empty free canvas, which is the scroll area itself. */
function doubleClickCanvas(container: HTMLElement) {
  const canvas = container.querySelector('.wally-scroll');
  expect(canvas).not.toBeNull();
  fireEvent.doubleClick(canvas!, { clientX: 300, clientY: 200 });
}

describe('WandView: every create path sends the note’s visibility', () => {
  describe('a viewer (every new note is private)', () => {
    const viewer = boardAccess('VIEW', 'me', 'all');

    it('sends PRIVATE from a zone’s add button', async () => {
      renderWall('horizon', viewer);
      await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Heute“ anlegen' }));

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'PRIVATE', horizon: 'HEUTE' }),
      );
    });

    it('sends PRIVATE from a double-click on a zone', async () => {
      renderWall('priority', viewer);
      await userEvent.dblClick(screen.getByRole('region', { name: /^Hoch/ }));

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'PRIVATE', priority: 'HOCH' }),
      );
    });

    it('sends PRIVATE from a double-click on the free canvas', async () => {
      const { container } = renderWall('free', viewer);
      doubleClickCanvas(container);

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'PRIVATE' }),
      );
    });
  });

  describe('an owner (control: new notes stay shared)', () => {
    const owner = boardAccess('OWNER', 'me', 'all');

    it('sends SHARED from a zone’s add button', async () => {
      renderWall('horizon', owner);
      await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Heute“ anlegen' }));

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'SHARED', horizon: 'HEUTE' }),
      );
    });

    it('sends SHARED from a double-click on the free canvas', async () => {
      const { container } = renderWall('free', owner);
      doubleClickCanvas(container);

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'SHARED' }),
      );
    });
  });
});
