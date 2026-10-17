import { useMemo } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
      language: 'de',
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
import { WandView } from '../WandView/WandView';
import { useCaptureSession } from './useCaptureSession';

const BOARD = 'board-1';
const owner = boardAccess('OWNER', 'me', 'all');
const EMPTY: NoteDto[] = [];

/** A tiny server behind the mocked API, so the board reads its notes through the real cache. */
let server: NoteDto[] = [];
let nextId = 1;

beforeEach(() => {
  vi.clearAllMocks();
  server = [makeNote({ id: 'n1', title: 'Vorhanden', horizon: 'HEUTE', priority: 'HOCH' })];
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
}: {
  view: BoardView;
  axis: BoardAxis;
  openNote: (id: string | null) => void;
  onCommitted?: (noteId: string, locked: SuggestionFieldKey[]) => void;
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
  });
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
            }
          }
        />
      ) : (
        <WandView
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
          visibility={owner.newNoteVisibility}
        />
      )}
    </>
  );
}

function renderBoard(view: BoardView, axis: BoardAxis) {
  const openNote = vi.fn();
  const onCommitted = vi.fn();
  const result = renderWithProviders(
    <Board view={view} axis={axis} openNote={openNote} onCommitted={onCommitted} />,
  );
  const rerender = (next: { view: BoardView; axis: BoardAxis }) =>
    result.rerender(
      <Board view={next.view} axis={next.axis} openNote={openNote} onCommitted={onCommitted} />,
    );
  return { ...result, openNote, onCommitted, rerender };
}

const captureCard = () => screen.findByRole('group', { name: 'Neue Notiz schreiben' });
const titleField = () => screen.findByRole('textbox', { name: 'Titel der neuen Notiz' });

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
  const card = screen.queryByRole('group', { name: 'Neue Notiz schreiben' });
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
      await screen.findByText('Vorhanden');
      await userEvent.click(screen.getByRole('button', { name: 'new' }));
      await userEvent.type(await titleField(), 'M');

      // The first keystroke created the note: the optimistic copy and then the server's.
      await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(vi.mocked(notesApi.list).mock.calls.length).toBeGreaterThan(1));
      expect(copiesOutsideCapture('M')).toEqual([]);
      if (view === 'wand') expect(container.querySelectorAll('[data-note-id]')).toHaveLength(1);

      await userEvent.type(await titleField(), 'ünchen{Enter}');
      await waitFor(() =>
        expect(screen.queryByRole('group', { name: 'Neue Notiz schreiben' })).toBeNull(),
      );
      expect(await screen.findAllByText('München')).toHaveLength(1);
      if (view === 'wand') expect(container.querySelectorAll('[data-note-id]')).toHaveLength(2);
    },
  );

  it('a plain Enter never opens the panel; ⌘↵ / Ctrl+↵ does', async () => {
    const { openNote } = renderBoard('wand', 'horizon');
    await screen.findByText('Vorhanden');
    await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Heute“ anlegen' }));
    await userEvent.type(await titleField(), 'Erste{Enter}');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Neue Notiz schreiben' })).toBeNull(),
    );
    await waitFor(() => expect(notesApi.update).toHaveBeenCalled());
    expect(openNote).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Heute“ anlegen' }));
    await userEvent.type(await titleField(), 'Zweite{Control>}{Enter}{/Control}');
    await waitFor(() => expect(openNote).toHaveBeenCalledWith('created-2'));
    expect(openNote).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'Neue Notiz schreiben' })).toBeNull();
  });

  it('after Enter, the keyboard carries on from the committed card', async () => {
    const { container } = renderBoard('wand', 'horizon');
    await screen.findByText('Vorhanden');
    await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Heute“ anlegen' }));
    await userEvent.type(await titleField(), 'Weiter{Enter}');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Neue Notiz schreiben' })).toBeNull(),
    );
    const card = container.querySelector('[data-note-id="created-1"] button');
    await waitFor(() => expect(card).toHaveFocus());
  });

  it('after Enter the shell hears which fields were typed', async () => {
    const { onCommitted } = renderBoard('wand', 'horizon');
    await screen.findByText('Vorhanden');
    await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Heute“ anlegen' }));
    await userEvent.type(await titleField(), 'Weg{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Neue Notiz schreiben' })).toBeNull(),
    );
    await waitFor(() => expect(notesApi.remove).toHaveBeenCalled());
    expect(onCommitted).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Heute“ anlegen' }));
    await userEvent.type(await titleField(), 'Bericht Freitag{Enter}');
    await waitFor(() => expect(onCommitted).toHaveBeenCalledWith('created-2', ['dueDate']));
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['priority', { priority: 'MITTEL' }],
    ['horizon', { horizon: 'HEUTE' }],
  ] as const)('N on the %s wall writes the note in the default zone', async (axis, expected) => {
    renderBoard('wand', axis);
    await screen.findByText('Vorhanden');
    await userEvent.click(screen.getByRole('button', { name: 'new' }));
    await userEvent.type(await titleField(), 'X');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(notesApi.create).mock.calls[0]![1]).toMatchObject(expected);
  });
});

describe('useCaptureSession: a capture never blocks the next one', () => {
  it('closes a capture the board can no longer show, and the next gesture opens one', async () => {
    const { rerender } = renderBoard('list', 'horizon');
    await screen.findByText('Vorhanden');
    await userEvent.click(screen.getByRole('button', { name: 'new' }));
    await userEvent.type(await titleField(), 'Liste');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));

    // Back/Forward or a resize to desktop: the list is gone, nothing blurred the card.
    rerender({ view: 'wand', axis: 'horizon' });
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Neue Notiz schreiben' })).toBeNull(),
    );
    // The words typed so far were kept on the note, and it is back on the board.
    expect(await screen.findByText('Liste')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Heute“ anlegen' }));
    expect(await captureCard()).toBeInTheDocument();
    expect(await titleField()).toHaveValue('');

    // Back to the list: the old capture does not come back.
    rerender({ view: 'list', axis: 'horizon' });
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Neue Notiz schreiben' })).toBeNull(),
    );
  });

  it('closes a zone capture when the axis changes under it', async () => {
    const { rerender } = renderBoard('wand', 'horizon');
    await screen.findByText('Vorhanden');
    await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Heute“ anlegen' }));
    await captureCard();

    rerender({ view: 'wand', axis: 'priority' });
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Neue Notiz schreiben' })).toBeNull(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Hoch“ anlegen' }));
    expect(await captureCard()).toBeInTheDocument();
  });

  it('a zone plus while a commit is still settling opens a fresh card there', async () => {
    renderBoard('wand', 'horizon');
    await screen.findByText('Vorhanden');
    await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Heute“ anlegen' }));
    await userEvent.type(await titleField(), 'Erste');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));

    // The blur commit's update hangs until released.
    const release = holdNextUpdate();
    // A real click: mousedown moves focus (the card blurs and starts its commit), then click.
    await userEvent.click(screen.getByRole('button', { name: 'Notiz in „Diese Woche“ anlegen' }));

    const week = screen.getByRole('region', { name: /^Diese Woche/ });
    const fresh = await within(week).findByRole('textbox', { name: 'Titel der neuen Notiz' });
    expect(fresh).toHaveValue('');
    expect(fresh).toHaveFocus();
    // The first note is no longer being written: the board shows it as a real card.
    const today = screen.getByRole('region', { name: /^Heute/ });
    expect(within(today).getByText('Erste')).toBeInTheDocument();
    expect(within(today).queryByRole('group', { name: 'Neue Notiz schreiben' })).toBeNull();

    // The first commit settles late; it must not close the card that replaced it.
    await settle(release);
    expect(notesApi.update).toHaveBeenCalledTimes(1);
    expect(within(week).getByRole('group', { name: 'Neue Notiz schreiben' })).toBeInTheDocument();
  });

  it('the same zone’s plus again while a commit is settling gives a fresh card, not the old one', async () => {
    renderBoard('wand', 'horizon');
    await screen.findByText('Vorhanden');
    const plus = screen.getByRole('button', { name: 'Notiz in „Heute“ anlegen' });
    await userEvent.click(plus);
    await userEvent.type(await titleField(), 'Alt');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));

    const release = holdNextUpdate();
    await userEvent.click(plus);
    expect(await titleField()).toHaveValue('');
    expect(await titleField()).not.toHaveAttribute('readonly');
    await userEvent.type(await titleField(), 'Neu');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(2));

    await settle(release);
    expect(await titleField()).toHaveValue('Neu');
    expect(screen.getByText('Alt')).toBeInTheDocument();
  });

  it('a second double-click on the canvas while the first capture has text moves the capture', async () => {
    const { container } = renderBoard('wand', 'free');
    await screen.findByText('Vorhanden');
    const canvas = screen.getByTestId('wand-canvas');
    fireEvent.doubleClick(canvas, { clientX: 300, clientY: 200 });
    await userEvent.type(await titleField(), 'Links');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));

    const release = holdNextUpdate();
    // The first mousedown blurs the card (its commit starts and hangs), the dblclick follows.
    await userEvent.dblClick(canvas);
    const card = await captureCard();
    expect(within(card).getByRole('textbox', { name: 'Titel der neuen Notiz' })).toHaveValue('');
    expect(screen.getByText('Links')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-note-id]')).toHaveLength(2);

    await settle(release);
    expect(screen.getByRole('group', { name: 'Neue Notiz schreiben' })).toBe(card);
  });
});
