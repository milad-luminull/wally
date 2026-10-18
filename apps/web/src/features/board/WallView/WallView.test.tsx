import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { boardAccess } from '../util/permissions';
import type { CapturePlacement } from '../Capture/useCapture';
import type { TidyController } from '../Tidy/useTidy';
import { WallView } from './WallView';

// The free canvas reads its backdrop from the profile; signed out, that query never runs.
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => ({ status: 'unauthenticated', user: null }) };
});

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  notesApi: { create: vi.fn(), list: vi.fn(), move: vi.fn(), update: vi.fn(), remove: vi.fn() },
  meApi: { get: vi.fn(), update: vi.fn() },
  membersApi: { list: vi.fn() },
}));

// The capture card parses date words in the person's language.
vi.mock('@/i18n/LanguageProvider', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/LanguageProvider')>('@/i18n/LanguageProvider');
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

import { membersApi, notesApi } from '@/lib/resources';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(notesApi.create).mockResolvedValue(makeNote({ id: 'created' }));
  vi.mocked(notesApi.list).mockResolvedValue([]);
  vi.mocked(membersApi.list).mockResolvedValue([]);
});

/** The wall with the shell's capture state: a create path opens a capture, done closes it. */
function Wall({
  axis,
  access,
  tidy,
}: {
  axis: 'horizon' | 'priority' | 'free';
  access: ReturnType<typeof boardAccess>;
  tidy?: TidyController;
}) {
  const notes = [makeNote({ id: 'n1', title: 'Existing', horizon: 'HEUTE', priority: 'HOCH' })];
  const [capture, setCapture] = useState<CapturePlacement | null>(null);
  return (
    <WallView
      boardId="board-1"
      notes={notes}
      totalNoteCount={notes.length}
      currentUserId="me"
      axis={axis}
      selectedNoteId={null}
      onOpenNote={vi.fn()}
      onDuplicateNote={vi.fn()}
      access={access}
      capture={capture}
      onCapture={setCapture}
      onCaptureDone={() => setCapture(null)}
      visibility={access.newNoteVisibility}
      tidy={tidy}
    />
  );
}

function renderWall(
  axis: 'horizon' | 'priority' | 'free',
  access: ReturnType<typeof boardAccess>,
  tidy?: TidyController,
) {
  return renderWithProviders(<Wall axis={axis} access={access} tidy={tidy} />);
}

/** A board's Tidy with two candidates and nothing asked yet. */
function idleTidy(): TidyController {
  return {
    phase: 'idle',
    count: 2,
    moving: 0,
    trackedIds: [],
    markFor: () => undefined,
    tidy: vi.fn(),
    keep: vi.fn(),
    discard: vi.fn(),
    undo: vi.fn(),
    undoLast: vi.fn(() => false),
    remove: vi.fn(),
  };
}

/** A create path opens the capture and sends nothing; the first keystroke creates the note. */
async function typeFirstLetter() {
  const title = await screen.findByRole('textbox', { name: 'Title of the new note' });
  expect(notesApi.create).not.toHaveBeenCalled();
  await userEvent.type(title, 'M');
}

/** A double-click on the empty free canvas, which is the scroll area itself. */
function doubleClickCanvas(container: HTMLElement) {
  const canvas = container.querySelector('.wally-scroll');
  expect(canvas).not.toBeNull();
  fireEvent.doubleClick(canvas!, { clientX: 300, clientY: 200 });
}

describe('WallView: every create path writes the note in place, with its visibility', () => {
  describe('a viewer (every new note is private)', () => {
    const viewer = boardAccess('VIEW', 'me', 'all');

    it('sends PRIVATE from a zone’s add button', async () => {
      renderWall('horizon', viewer);
      await userEvent.click(screen.getByRole('button', { name: 'Add a note to “Today”' }));
      await typeFirstLetter();

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'PRIVATE', horizon: 'HEUTE' }),
      );
    });

    it('sends PRIVATE from a double-click on a zone', async () => {
      renderWall('priority', viewer);
      await userEvent.dblClick(screen.getByRole('region', { name: /^High/ }));
      await typeFirstLetter();

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'PRIVATE', priority: 'HOCH' }),
      );
    });

    it('sends PRIVATE from a double-click on the free canvas', async () => {
      const { container } = renderWall('free', viewer);
      doubleClickCanvas(container);
      await typeFirstLetter();

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'PRIVATE', freeX: 300, freeY: 200 }),
      );
    });
  });

  describe('an owner (control: new notes stay shared)', () => {
    const owner = boardAccess('OWNER', 'me', 'all');

    it('sends SHARED from a zone’s add button', async () => {
      renderWall('horizon', owner);
      await userEvent.click(screen.getByRole('button', { name: 'Add a note to “Today”' }));
      await typeFirstLetter();

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'SHARED', horizon: 'HEUTE' }),
      );
    });

    it('sends SHARED from a double-click on a zone', async () => {
      renderWall('priority', owner);
      await userEvent.dblClick(screen.getByRole('region', { name: /^High/ }));
      await typeFirstLetter();

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'SHARED', priority: 'HOCH' }),
      );
    });

    it('sends SHARED from a double-click on the free canvas, writing at the click point', async () => {
      const { container } = renderWall('free', owner);
      doubleClickCanvas(container);
      const card = await screen.findByRole('group', { name: 'Write a new note' });
      expect(card.parentElement).toHaveStyle({ left: '300px', top: '200px' });
      await typeFirstLetter();

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'SHARED', freeX: 300, freeY: 200 }),
      );
    });
  });
});

describe('WallView: the Tidy bar', () => {
  const owner = boardAccess('OWNER', 'me', 'all');

  it('sits under the bands of the horizon wall', () => {
    renderWall('horizon', owner, idleTidy());
    const bar = screen.getByRole('toolbar', { name: 'Tidy' });
    expect(screen.getByRole('button', { name: 'Tidy 2 notes' })).toBeInTheDocument();
    // The bands come first in the same column, so the strip is below them, never between.
    const bands = bar.previousElementSibling;
    expect(bands).not.toBeNull();
    expect(bands).toContainElement(screen.getByRole('region', { name: /^Today/ }));
  });

  it('is not on the priority wall, whose rows still scroll inside the column', () => {
    const { container } = renderWall('priority', owner, idleTidy());
    expect(screen.queryByRole('toolbar', { name: 'Tidy' })).toBeNull();
    // jsdom lays nothing out: min-h-0 is what lets a flex child of the column scroll.
    expect(container.querySelector('.wally-scroll')).toHaveClass('min-h-0', 'overflow-y-auto');
  });

  it('is not on the free canvas', () => {
    renderWall('free', owner, idleTidy());
    expect(screen.queryByRole('toolbar', { name: 'Tidy' })).toBeNull();
  });
});
