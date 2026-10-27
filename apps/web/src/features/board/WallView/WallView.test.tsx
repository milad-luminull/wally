import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { boardAccess } from '../util/permissions';
import type { CapturePlacement } from '../Capture/useCapture';
import type { TidyController } from '../Tidy/useTidy';
import type { TidyProps } from '../Tidy/tidyProps';
import type { NoteDto } from '@wally/shared';
import type { InlineEditProps } from '../Capture/inlineEdit';
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
  relatedCounts,
  tidy,
  tidyFor,
  editFor,
}: {
  axis: 'horizon' | 'priority' | 'free';
  access: ReturnType<typeof boardAccess>;
  relatedCounts?: ReadonlyMap<string, number>;
  tidy?: TidyController;
  tidyFor?: (noteId: string) => TidyProps | undefined;
  editFor?: (note: NoteDto) => InlineEditProps | undefined;
}) {
  const notes = [makeNote({ id: 'n1', title: 'Existing', horizon: 'TODAY', priority: 'HIGH' })];
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
      relatedCounts={relatedCounts}
      tidy={tidy}
      tidyFor={tidyFor}
      editFor={editFor}
    />
  );
}

function renderWall(
  axis: 'horizon' | 'priority' | 'free',
  access: ReturnType<typeof boardAccess>,
  tidy?: TidyController,
  tidyFor?: (noteId: string) => TidyProps | undefined,
) {
  return renderWithProviders(<Wall axis={axis} access={access} tidy={tidy} tidyFor={tidyFor} />);
}

/** The card of note n1 in a pending batch that would send it to This week. */
const pendingTidyFor = (noteId: string): TidyProps | undefined =>
  noteId === 'n1'
    ? {
        mark: { to: 'THIS_WEEK', from: 'TODAY', reason: null, source: 'words', phase: 'pending' },
        onKeep: vi.fn(),
        onDiscard: vi.fn(),
        onUndo: vi.fn(),
        onRemove: vi.fn(),
      }
    : undefined;

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
    lastKeptAt: () => null,
    remove: vi.fn(),
    failure: null,
    retry: vi.fn(),
    dismissFailure: vi.fn(),
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

// The board resolves each card's related count (relatedCounts, L1, L7); every layout shows
// the count it is given, here for a note with no links of its own that another note links to.
describe('WallView: the related count comes from the board', () => {
  it.each(['horizon', 'priority', 'free'] as const)('shows it on the %s wall', (axis) => {
    renderWithProviders(
      <Wall
        axis={axis}
        access={boardAccess('OWNER', 'me', 'all')}
        relatedCounts={new Map([['n1', 1]])}
      />,
    );
    expect(screen.getByText('1 related')).toBeInTheDocument();
  });
});

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
        expect.objectContaining({ visibility: 'PRIVATE', horizon: 'TODAY' }),
      );
    });

    it('sends PRIVATE from a double-click on a zone', async () => {
      renderWall('priority', viewer);
      await userEvent.dblClick(screen.getByRole('region', { name: /^High/ }));
      await typeFirstLetter();

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'PRIVATE', priority: 'HIGH' }),
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

  describe('a double-click on a card', () => {
    it.each(['priority', 'horizon', 'free'] as const)(
      'edits the card on the %s wall and opens no new note',
      async (axis) => {
        const start = vi.fn();
        const editFor = () => ({ boardId: 'board-1', editing: false, start, done: vi.fn() });
        renderWithProviders(
          <Wall axis={axis} access={boardAccess('OWNER', 'me', 'all')} editFor={editFor} />,
        );
        await userEvent.dblClick(screen.getByText('Existing'));
        expect(start).toHaveBeenCalled();
        expect(screen.queryByRole('group', { name: 'Write a new note' })).not.toBeInTheDocument();
      },
    );
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
        expect.objectContaining({ visibility: 'SHARED', horizon: 'TODAY' }),
      );
    });

    it('sends SHARED from a double-click on a zone', async () => {
      renderWall('priority', owner);
      await userEvent.dblClick(screen.getByRole('region', { name: /^High/ }));
      await typeFirstLetter();

      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      expect(notesApi.create).toHaveBeenCalledWith(
        'board-1',
        expect.objectContaining({ visibility: 'SHARED', priority: 'HIGH' }),
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

  it('is not on the priority wall, whose columns share a scroll container', () => {
    const { container } = renderWall('priority', owner, idleTidy());
    // The strip itself, which is a toolbar only while it holds a control.
    expect(container.querySelector('[data-tidy-bar]')).toBeNull();
    // jsdom lays nothing out: min-h-0 is what lets a flex child of the column scroll.
    expect(container.querySelector('.wally-scroll')).toHaveClass('min-h-0', 'overflow-y-auto');
  });

  it('is not on the free canvas', () => {
    const { container } = renderWall('free', owner, idleTidy());
    expect(container.querySelector('[data-tidy-bar]')).toBeNull();
  });

  it('is not there, and reserves no strip, when the shell passes no Tidy (the assistant off)', () => {
    const { container } = renderWall('horizon', owner);
    expect(screen.queryByRole('toolbar', { name: 'Tidy' })).toBeNull();
    expect(container.querySelector('[data-tidy-bar]')).toBeNull();
  });
});

describe('WallView: a card of a Tidy batch', () => {
  const owner = boardAccess('OWNER', 'me', 'all');

  it('shows where it would go on the horizon wall', () => {
    const { container } = renderWall('horizon', owner, idleTidy(), pendingTidyFor);
    expect(container.querySelector('[data-note-id="n1"] [data-tidy]')).toHaveAttribute(
      'data-tidy',
      'pending',
    );
  });

  it('shows nothing of the batch on the priority wall, even when handed one (R10)', () => {
    const { container } = renderWall('priority', owner, idleTidy(), pendingTidyFor);
    expect(container.querySelector('[data-note-id="n1"]')).not.toBeNull();
    expect(container.querySelector('[data-tidy]')).toBeNull();
  });
});

describe('WallView answer card', () => {
  const owner = boardAccess('OWNER', 'me', 'all');
  const notes = [makeNote({ id: 'n1', title: 'Existing', horizon: 'TODAY' })];

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
            key: 'THIS_WEEK',
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
