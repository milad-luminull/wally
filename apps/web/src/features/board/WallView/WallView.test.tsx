import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { boardAccess } from '../util/permissions';
import type { CapturePlacement } from '../Capture/useCapture';
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
}: {
  axis: 'horizon' | 'priority' | 'free';
  access: ReturnType<typeof boardAccess>;
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
    />
  );
}

function renderWall(axis: 'horizon' | 'priority' | 'free', access: ReturnType<typeof boardAccess>) {
  return renderWithProviders(<Wall axis={axis} access={access} />);
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

describe('WallView answer card', () => {
  const owner = boardAccess('OWNER', 'me', 'all');
  const notes = [makeNote({ id: 'n1', title: 'Existing', horizon: 'HEUTE' })];

  function renderWithAnswer(onCapture = vi.fn()) {
    return renderWithProviders(
      <WallView
        boardId="board-1"
        notes={notes}
        totalNoteCount={notes.length}
        currentUserId="me"
        axis="horizon"
        selectedNoteId={null}
        onOpenNote={vi.fn()}
        onDuplicateNote={vi.fn()}
        access={owner}
        capture={null}
        onCapture={onCapture}
        onCaptureDone={vi.fn()}
        visibility={owner.newNoteVisibility}
        ask={{
          key: 1,
          placement: {
            kind: 'zone',
            axis: 'horizon',
            key: 'DIESE_WOCHE',
            at: { freeX: 0, freeY: 0 },
          },
          card: <div data-testid="answer" />,
        }}
      />,
    );
  }

  it('draws the answer card at the top of the zone the question was written in', () => {
    renderWithAnswer();
    const thisWeek = screen.getByRole('region', { name: /^This week/ });
    const answer = within(thisWeek).getByTestId('answer');
    expect(answer.parentElement).toHaveAttribute('data-ask');
    // The answer takes the empty zone's place, and the other zones are left as they were.
    expect(within(thisWeek).queryByText('Empty')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: /^Today/ })).queryByTestId('answer'),
    ).not.toBeInTheDocument();
  });

  it('lets the answer card shrink to a column narrower than the card', () => {
    // A flex item keeps min-width:auto, so without min-w-0 the 376px card would never
    // shrink and its own max-w-full could not cap it to the zone column.
    renderWithAnswer();
    const wrapper = screen.getByTestId('answer').parentElement;
    expect(wrapper).toHaveClass('min-w-0', 'max-w-full');
  });

  it('does not start a note when a word in the answer is double-clicked', async () => {
    const onCapture = vi.fn();
    renderWithAnswer(onCapture);
    await userEvent.dblClick(screen.getByTestId('answer'));
    expect(onCapture).not.toHaveBeenCalled();
  });
});
