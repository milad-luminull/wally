import { useMemo } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NoteDto, SuggestionFieldKey } from '@wally/shared';

// The free canvas reads its backdrop from the profile; signed out, that query never runs.
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => ({ status: 'unauthenticated', user: null }) };
});
vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  notesApi: {
    create: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    assign: vi.fn(),
    remove: vi.fn(),
  },
  meApi: { get: vi.fn(), update: vi.fn() },
  membersApi: { list: vi.fn() },
}));
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
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { useNotes } from '../hooks/useNotes';
import type { BoardAxis, BoardView } from '../hooks/useBoardViewState';
import { boardAccess } from '../util/permissions';
import { defaultZoneKey } from '../util/noteDerived';
import { nextFreeNotePosition } from '../util/notePlacement';
import { ListView } from '../ListView/ListView';
import { WallView } from '../WallView/WallView';
import type { CapturePlacement } from './useCapture';
import { useCaptureSession } from './useCaptureSession';

const BOARD = 'board-1';
const owner = boardAccess('OWNER', 'me', 'all');
const EMPTY: NoteDto[] = [];

/** A tiny server behind the mocked API, so the board reads its notes through the real cache. */
let server: NoteDto[] = [];
let nextId = 1;

beforeEach(() => {
  vi.clearAllMocks();
  server = [makeNote({ id: 'n1', title: 'Existing', horizon: 'HEUTE', priority: 'HOCH' })];
  nextId = 1;
  vi.mocked(notesApi.list).mockImplementation(async () => server.map((n) => ({ ...n })));
  vi.mocked(notesApi.create).mockImplementation(async (_board, input) => {
    const note = makeNote({ ...input, id: `created-${nextId++}` } as Partial<NoteDto>);
    server = [...server, note];
    return note;
  });
  vi.mocked(notesApi.update).mockImplementation(async (noteId, input) => {
    server = server.map((n) => (n.id === noteId ? { ...n, ...(input as Partial<NoteDto>) } : n));
    return server.find((n) => n.id === noteId)!;
  });
  vi.mocked(notesApi.remove).mockImplementation(async (noteId) => {
    server = server.filter((n) => n.id !== noteId);
  });
  vi.mocked(membersApi.list).mockResolvedValue([]);
});

/**
 * The shell's half of the board, as AppShell composes it: the notes from the real cache,
 * the capture session, and the real views fed the notes without the one being written.
 */
function Board({
  view,
  axis,
  openNote,
  onCommitted,
  onAsked,
}: {
  view: BoardView;
  axis: BoardAxis;
  openNote: (id: string | null) => void;
  onCommitted?: (noteId: string, locked: SuggestionFieldKey[]) => void;
  /** Given when the board's assistant is on, as the shell does; absent, a `?` is a plain title. */
  onAsked?: (question: string, placement: CapturePlacement) => void;
}) {
  const query = useNotes(BOARD);
  const notes = query.data ?? EMPTY;
  const session = useCaptureSession({
    boardId: BOARD,
    view,
    axis,
    openNoteId: null,
    openNote,
    onCommitted,
    onAsked,
  });
  const onCaptureAsk = onAsked ? session.onCaptureAsk : undefined;
  const { withoutCapturing } = session;
  const boardNotes = useMemo(() => withoutCapturing(notes), [notes, withoutCapturing]);
  if (query.isLoading) return null;
  const newNote = () =>
    view === 'list'
      ? session.startCapture({ kind: 'list' })
      : axis === 'free'
        ? session.startCapture({ kind: 'free', x: 40, y: 40 })
        : session.startCapture({
            kind: 'zone',
            axis,
            key: defaultZoneKey(axis),
            at: nextFreeNotePosition(notes),
          });
  return (
    <>
      <button type="button" onClick={newNote}>
        new
      </button>
      {view === 'list' ? (
        <ListView
          notes={boardNotes}
          totalNoteCount={boardNotes.length}
          axis={axis}
          currentUserId="me"
          onOpenNote={openNote}
          onToggleDone={vi.fn()}
          access={owner}
          isBelowDesktop={false}
          capture={
            session.capture && {
              id: session.captureKey,
              boardId: BOARD,
              visibility: owner.newNoteVisibility,
              onDone: session.onCaptureDone,
              onNoteId: session.onCaptureNoteId,
              onAsk: onCaptureAsk,
            }
          }
        />
      ) : (
        <WallView
          boardId={BOARD}
          notes={boardNotes}
          totalNoteCount={boardNotes.length}
          currentUserId="me"
          axis={axis}
          selectedNoteId={null}
          onOpenNote={openNote}
          onDuplicateNote={vi.fn()}
          access={owner}
          capture={session.capture}
          captureKey={session.captureKey}
          onCapture={session.startCapture}
          onCaptureDone={session.onCaptureDone}
          onCaptureNoteId={session.onCaptureNoteId}
          onCaptureAsk={onCaptureAsk}
          visibility={owner.newNoteVisibility}
        />
      )}
    </>
  );
}

function renderBoard(
  view: BoardView,
  axis: BoardAxis,
  onAsked?: (question: string, placement: CapturePlacement) => void,
) {
  const openNote = vi.fn();
  const onCommitted = vi.fn();
  const result = renderWithProviders(
    <Board
      view={view}
      axis={axis}
      openNote={openNote}
      onCommitted={onCommitted}
      onAsked={onAsked}
    />,
  );
  const rerender = (next: { view: BoardView; axis: BoardAxis }) =>
    result.rerender(
      <Board
        view={next.view}
        axis={next.axis}
        openNote={openNote}
        onCommitted={onCommitted}
        onAsked={onAsked}
      />,
    );
  return { ...result, openNote, onCommitted, rerender };
}

const captureCard = () => screen.findByRole('group', { name: 'Write a new note' });
const titleField = () => screen.findByRole('textbox', { name: 'Title of the new note' });

/** Holds the next update (the blur commit's) until the returned function is called. */
function holdNextUpdate() {
  let resolveHeld: (() => void) | null = null;
  vi.mocked(notesApi.update).mockImplementationOnce(
    (noteId, input) =>
      new Promise((resolve) => {
        resolveHeld = () => {
          server = server.map((n) =>
            n.id === noteId ? { ...n, ...(input as Partial<NoteDto>) } : n,
          );
          resolve(server.find((n) => n.id === noteId)!);
        };
      }),
  );
  return () => resolveHeld?.();
}

/** Lets a held commit land, and everything it sets off settle. */
async function settle(release: () => void) {
  await waitFor(() => expect(notesApi.update).toHaveBeenCalled());
  await act(async () => {
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** Every place the board draws this title, outside the card it is being written in. */
function copiesOutsideCapture(title: string) {
  const card = screen.queryByRole('group', { name: 'Write a new note' });
  return screen.queryAllByText(title).filter((el) => !card?.contains(el));
}

describe('useCaptureSession: the note being written has one card', () => {
  it.each([
    ['in a zone', 'wand', 'horizon'],
    ['on the free canvas', 'wand', 'free'],
    ['in the list', 'list', 'horizon'],
  ] as const)(
    'shows only the capture %s while typing, then the real card on commit',
    async (_where, view, axis) => {
      const { container } = renderBoard(view, axis);
      await screen.findByText('Existing');
      await userEvent.click(screen.getByRole('button', { name: 'new' }));
      await userEvent.type(await titleField(), 'M');

      // The first keystroke created the note: the optimistic copy and then the server's.
      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(vi.mocked(notesApi.list).mock.calls.length).toBeGreaterThan(1));
      expect(copiesOutsideCapture('M')).toEqual([]);
      if (view === 'wand') expect(container.querySelectorAll('[data-note-id]')).toHaveLength(1);

      await userEvent.type(await titleField(), 'unich{Enter}');
      await waitFor(() =>
        expect(screen.queryByRole('group', { name: 'Write a new note' })).toBeNull(),
      );
      expect(await screen.findAllByText('Munich')).toHaveLength(1);
      if (view === 'wand') expect(container.querySelectorAll('[data-note-id]')).toHaveLength(2);
    },
  );

  it('a plain Enter never opens the panel; ⌘↵ / Ctrl+↵ does', async () => {
    const { openNote } = renderBoard('wand', 'horizon');
    await screen.findByText('Existing');
    await userEvent.click(screen.getByRole('button', { name: 'Add a note to “Today”' }));
    await userEvent.type(await titleField(), 'First{Enter}');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Write a new note' })).toBeNull(),
    );
    await waitFor(() => expect(notesApi.update).toHaveBeenCalled());
    expect(openNote).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Add a note to “Today”' }));
    await userEvent.type(await titleField(), 'Second{Control>}{Enter}{/Control}');
    await waitFor(() => expect(openNote).toHaveBeenCalledWith('created-2'));
    expect(openNote).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'Write a new note' })).toBeNull();
  });

  it('after Enter, the keyboard carries on from the committed card', async () => {
    const { container } = renderBoard('wand', 'horizon');
    await screen.findByText('Existing');
    await userEvent.click(screen.getByRole('button', { name: 'Add a note to “Today”' }));
    await userEvent.type(await titleField(), 'Onward{Enter}');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Write a new note' })).toBeNull(),
    );
    const card = container.querySelector('[data-note-id="created-1"] button');
    await waitFor(() => expect(card).toHaveFocus());
  });

  it('after Enter in the list, the keyboard carries on from the committed row', async () => {
    const { container } = renderBoard('list', 'horizon');
    await screen.findByText('Existing');
    await userEvent.click(screen.getByRole('button', { name: 'new' }));
    await userEvent.type(await titleField(), 'Row{Enter}');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Write a new note' })).toBeNull(),
    );
    // The row itself, not its checkbox: Enter on the row is what keeps a pending change.
    const row = container.querySelector('[data-note-id="created-1"][role="button"]');
    expect(row).not.toBeNull();
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('after Enter the shell hears which fields were typed', async () => {
    const { onCommitted } = renderBoard('wand', 'horizon');
    await screen.findByText('Existing');
    await userEvent.click(screen.getByRole('button', { name: 'Add a note to “Today”' }));
    await userEvent.type(await titleField(), 'Gone{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Write a new note' })).toBeNull(),
    );
    await waitFor(() => expect(notesApi.remove).toHaveBeenCalled());
    expect(onCommitted).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Add a note to “Today”' }));
    await userEvent.type(await titleField(), 'Report Friday{Enter}');
    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith('created-2', ['dueDate']));
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['priority', { priority: 'MITTEL' }],
    ['horizon', { horizon: 'HEUTE' }],
  ] as const)('N on the %s wall writes the note in the default zone', async (axis, expected) => {
    renderBoard('wand', axis);
    await screen.findByText('Existing');
    await userEvent.click(screen.getByRole('button', { name: 'new' }));
    await userEvent.type(await titleField(), 'X');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(notesApi.create).mock.calls[0]![1]).toMatchObject(expected);
  });
});

describe('useCaptureSession: a capture never blocks the next one', () => {
  it('closes a capture the board can no longer show, and the next gesture opens one', async () => {
    const { rerender } = renderBoard('list', 'horizon');
    await screen.findByText('Existing');
    await userEvent.click(screen.getByRole('button', { name: 'new' }));
    await userEvent.type(await titleField(), 'Listed');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));

    // Back/Forward or a resize to desktop: the list is gone, nothing blurred the card.
    rerender({ view: 'wand', axis: 'horizon' });
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Write a new note' })).toBeNull(),
    );
    // The words typed so far were kept on the note, and it is back on the board.
    expect(await screen.findByText('Listed')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add a note to “Today”' }));
    expect(await captureCard()).toBeInTheDocument();
    expect(await titleField()).toHaveValue('');

    // Back to the list: the old capture does not come back.
    rerender({ view: 'list', axis: 'horizon' });
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Write a new note' })).toBeNull(),
    );
  });

  it('closes a zone capture when the axis changes under it', async () => {
    const { rerender } = renderBoard('wand', 'horizon');
    await screen.findByText('Existing');
    await userEvent.click(screen.getByRole('button', { name: 'Add a note to “Today”' }));
    await captureCard();

    rerender({ view: 'wand', axis: 'priority' });
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Write a new note' })).toBeNull(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a note to “High”' }));
    expect(await captureCard()).toBeInTheDocument();
  });

  it('a zone plus while a commit is still settling opens a fresh card there', async () => {
    renderBoard('wand', 'horizon');
    await screen.findByText('Existing');
    await userEvent.click(screen.getByRole('button', { name: 'Add a note to “Today”' }));
    await userEvent.type(await titleField(), 'First');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));

    // The blur commit's update hangs until released.
    const release = holdNextUpdate();
    // A real click: mousedown moves focus (the card blurs and starts its commit), then click.
    await userEvent.click(screen.getByRole('button', { name: 'Add a note to “This week”' }));

    const week = screen.getByRole('region', { name: /^This week/ });
    const fresh = await within(week).findByRole('textbox', { name: 'Title of the new note' });
    expect(fresh).toHaveValue('');
    expect(fresh).toHaveFocus();
    // The first note is no longer being written: the board shows it as a real card.
    const today = screen.getByRole('region', { name: /^Today/ });
    expect(within(today).getByText('First')).toBeInTheDocument();
    expect(within(today).queryByRole('group', { name: 'Write a new note' })).toBeNull();

    // The first commit settles late; it must not close the card that replaced it.
    await settle(release);
    expect(notesApi.update).toHaveBeenCalledTimes(1);
    expect(within(week).getByRole('group', { name: 'Write a new note' })).toBeInTheDocument();
  });

  it('the same zone’s plus again while a commit is settling gives a fresh card, not the old one', async () => {
    renderBoard('wand', 'horizon');
    await screen.findByText('Existing');
    const plus = screen.getByRole('button', { name: 'Add a note to “Today”' });
    await userEvent.click(plus);
    await userEvent.type(await titleField(), 'Old');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));

    const release = holdNextUpdate();
    await userEvent.click(plus);
    expect(await titleField()).toHaveValue('');
    expect(await titleField()).not.toHaveAttribute('readonly');
    await userEvent.type(await titleField(), 'New');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(2));

    await settle(release);
    expect(await titleField()).toHaveValue('New');
    expect(screen.getByText('Old')).toBeInTheDocument();
  });

  it('a second double-click on the canvas while the first capture has text moves the capture', async () => {
    const { container } = renderBoard('wand', 'free');
    await screen.findByText('Existing');
    const canvas = screen.getByTestId('wall-canvas');
    fireEvent.doubleClick(canvas, { clientX: 300, clientY: 200 });
    await userEvent.type(await titleField(), 'Left');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));

    const release = holdNextUpdate();
    // The first mousedown blurs the card (its commit starts and hangs), the dblclick follows.
    await userEvent.dblClick(canvas);
    const card = await captureCard();
    expect(within(card).getByRole('textbox', { name: 'Title of the new note' })).toHaveValue('');
    expect(screen.getByText('Left')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-note-id]')).toHaveLength(2);

    await settle(release);
    expect(screen.getByRole('group', { name: 'Write a new note' })).toBe(card);
  });
});

describe('useCaptureSession asking', () => {
  it('hands a question to onAsked with the placement of the capture it was typed in', () => {
    const onAsked = vi.fn();
    const { result } = renderHook(() =>
      useCaptureSession({
        boardId: BOARD,
        view: 'wand',
        axis: 'free',
        openNoteId: null,
        openNote: vi.fn(),
        onAsked,
      }),
    );
    act(() => result.current.startCapture({ kind: 'free', x: 40, y: 60 }));
    act(() => result.current.onCaptureAsk('What is open?'));
    expect(onAsked).toHaveBeenCalledWith('What is open?', { kind: 'free', x: 40, y: 60 });

    // The capture then ends with no note, as a discarded one does; nothing else is heard.
    act(() => result.current.onCaptureDone(null, false, []));
    expect(result.current.capture).toBeNull();
    act(() => result.current.onCaptureAsk('Late?'));
    expect(onAsked).toHaveBeenCalledTimes(1);
  });
});

describe('useCaptureSession asking from the real views', () => {
  it.each([
    [
      'in a zone',
      'wand',
      'horizon',
      'Add a note to “Today”',
      { kind: 'zone', axis: 'horizon', key: 'HEUTE' },
    ],
    ['on the free canvas', 'wand', 'free', 'new', { kind: 'free', x: 40, y: 40 }],
    ['in the list', 'list', 'horizon', 'new', { kind: 'list' }],
  ] as const)(
    'a question typed %s reaches the shell with its placement and leaves no note',
    async (_where, view, axis, opener, placement) => {
      let focusedAtAsk: Element | null = null;
      const onAsked = vi.fn(() => {
        focusedAtAsk = document.activeElement;
      });
      const { onCommitted } = renderBoard(view, axis, onAsked);
      await screen.findByText('Existing');
      await userEvent.click(screen.getByRole('button', { name: opener }));
      await userEvent.type(await titleField(), 'What is open?{Enter}');

      await waitFor(() =>
        expect(onAsked).toHaveBeenCalledWith('What is open?', expect.objectContaining(placement)),
      );
      expect(onAsked).toHaveBeenCalledTimes(1);
      // The capture let go of the focus before the shell heard the question (plan R8).
      expect(focusedAtAsk).toBe(document.body);
      await waitFor(() =>
        expect(screen.queryByRole('group', { name: 'Write a new note' })).toBeNull(),
      );
      await waitFor(() =>
        expect(notesApi.remove).toHaveBeenCalledWith('created-1', expect.anything()),
      );
      expect(server.map((n) => n.id)).toEqual(['n1']);
      expect(onCommitted).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['in a zone', 'wand', 'horizon', 'Add a note to “Today”'],
    ['on the free canvas', 'wand', 'free', 'new'],
    ['in the list', 'list', 'horizon', 'new'],
  ] as const)(
    'with the assistant off, a question mark typed %s is a plain note',
    async (_where, view, axis, opener) => {
      const { onCommitted } = renderBoard(view, axis);
      await screen.findByText('Existing');
      await userEvent.click(screen.getByRole('button', { name: opener }));
      await userEvent.type(await titleField(), 'What is open?{Enter}');
      await waitFor(() => expect(onCommitted).toHaveBeenCalledWith('created-1', []));
      expect(notesApi.remove).not.toHaveBeenCalled();
      expect(await screen.findAllByText('What is open?')).toHaveLength(1);
    },
  );
});
