import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => ({ user: null, signOut: vi.fn() }) };
});

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

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  boardsApi: { list: vi.fn().mockResolvedValue([]) },
  // The capture card reads the members for its person chips and creates on the first key.
  membersApi: { list: vi.fn().mockResolvedValue([]) },
  notesApi: {
    create: vi.fn().mockResolvedValue({ id: 'n-new' }),
    update: vi.fn(),
    move: vi.fn(),
    assign: vi.fn(),
    remove: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
  },
}));

import { renderWithProviders } from '@/test/renderWithProviders';
import { isMac } from '@/lib/shortcuts';
import { BoardCommands } from './BoardCommands';
import { InlineCaptureCard } from './Capture/InlineCaptureCard';

const PALETTE = isMac ? '{Meta>}k{/Meta}' : '{Control>}k{/Control}';
const MOD = isMac ? '{Meta>}d{/Meta}' : '{Control>}d{/Control}';
const ASK = isMac ? '{Meta>}j{/Meta}' : '{Control>}j{/Control}';

function renderCommands(
  overrides: Partial<Parameters<typeof BoardCommands>[0]> = {},
  alongside: ReactNode = null,
) {
  const onDuplicateNote = vi.fn();
  const onNewNote = vi.fn();
  const onOpenAssistant = vi.fn();
  const { unmount } = renderWithProviders(
    <>
      {alongside}
      <BoardCommands
        boardId="board-1"
        notes={[]}
        view="wand"
        axis="horizon"
        done={false}
        mine={false}
        isDesktop
        newNoteVisibility="SHARED"
        canDuplicateOpenNote
        noteOpen
        onNewNote={onNewNote}
        onDuplicateNote={onDuplicateNote}
        onOpenNote={vi.fn()}
        onCloseNote={vi.fn()}
        onSetView={vi.fn()}
        onSetAxis={vi.fn()}
        onSetDone={vi.fn()}
        onSetMine={vi.fn()}
        onResetView={vi.fn()}
        assistantEnabled
        onOpenAssistant={onOpenAssistant}
        onUndoSuggestion={() => false}
        {...overrides}
      />
    </>,
  );
  return { onDuplicateNote, onNewNote, onOpenAssistant, unmount };
}

describe('BoardCommands', () => {
  beforeEach(() => vi.clearAllMocks());

  it('duplicates the open note on ⌘D / Ctrl+D', async () => {
    const { onDuplicateNote } = renderCommands();
    await userEvent.keyboard(MOD);
    expect(onDuplicateNote).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an open note', async () => {
    const closed = renderCommands({ noteOpen: false });
    await userEvent.keyboard(MOD);
    expect(closed.onDuplicateNote).not.toHaveBeenCalled();
  });

  it('does not duplicate a note the member cannot edit', async () => {
    const viewer = renderCommands({ canDuplicateOpenNote: false });
    await userEvent.keyboard(MOD);
    expect(viewer.onDuplicateNote).not.toHaveBeenCalled();
  });

  it('leaves n to the note being written: it is a letter in the capture, not a new note', async () => {
    const { onNewNote } = renderCommands(
      { noteOpen: false },
      <InlineCaptureCard
        boardId="board-1"
        placement={{ kind: 'list' }}
        visibility="SHARED"
        layout="row"
        onDone={vi.fn()}
      />,
    );
    const title = screen.getByRole('textbox', { name: 'Titel der neuen Notiz' });
    await waitFor(() => expect(title).toHaveFocus());
    await userEvent.keyboard('n');
    expect(title).toHaveValue('n');
    expect(onNewNote).not.toHaveBeenCalled();
  });

  it('lets a viewer press n to add a private note, and names it so in the palette', async () => {
    const { onNewNote } = renderCommands({
      newNoteVisibility: 'PRIVATE',
      canDuplicateOpenNote: false,
    });

    await userEvent.keyboard('n');
    expect(onNewNote).toHaveBeenCalledTimes(1);

    await userEvent.keyboard(PALETTE);
    expect(await screen.findByText('Neue private Notiz')).toBeInTheDocument();
    expect(screen.queryByText('Neue Notiz')).not.toBeInTheDocument();
    expect(screen.queryByText('Notiz duplizieren')).not.toBeInTheDocument();
  });

  it('lists the question entry and opens it with mod+j when the assistant is on', async () => {
    const { onOpenAssistant } = renderCommands({ assistantEnabled: true });
    const user = userEvent.setup();

    await user.keyboard(PALETTE);
    await user.click(await screen.findByText('Wand fragen…'));
    // The palette runs its actions on the next frame, once the dialog has let go of focus.
    await waitFor(() => expect(onOpenAssistant).toHaveBeenCalledTimes(1));

    await user.keyboard(ASK);
    expect(onOpenAssistant).toHaveBeenCalledTimes(2);
  });

  it('does not open the question panel with mod+j behind an open dialog', async () => {
    const { onOpenAssistant } = renderCommands({ assistantEnabled: true });
    const user = userEvent.setup();

    // The shortcuts sheet, not the palette: cmdk claims Ctrl+J itself, which would hide the bug.
    await user.keyboard('?');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard(ASK);
    expect(onOpenAssistant).not.toHaveBeenCalled();
  });

  it('shows the mod+j hint on the palette entry', async () => {
    renderCommands({ assistantEnabled: true });
    const user = userEvent.setup();

    await user.keyboard(PALETTE);
    const entry = (await screen.findByText('Wand fragen…')).closest('[cmdk-item]');
    expect(entry).toHaveTextContent(/J$/);
  });

  it('has no question entry and no shortcut when the assistant is off', async () => {
    const { onOpenAssistant } = renderCommands({ assistantEnabled: false });
    const user = userEvent.setup();

    await user.keyboard(PALETTE);
    expect(await screen.findByText('Neue Notiz')).toBeInTheDocument();
    expect(screen.queryByText('Wand fragen…')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.keyboard(ASK);
    expect(onOpenAssistant).not.toHaveBeenCalled();
  });

  it('lists ⌘Z in the shortcuts sheet when Wallybot can fill in, and not otherwise', async () => {
    const user = userEvent.setup();
    const { unmount } = renderCommands({ assistantEnabled: true });
    await user.keyboard('?');
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Übernommene Änderung rückgängig')).toBeInTheDocument();
    unmount();
    renderCommands({ assistantEnabled: false });
    await user.keyboard('?');
    expect(
      within(await screen.findByRole('dialog')).queryByText('Übernommene Änderung rückgängig'),
    ).toBeNull();
  });

  it('⌘Z undoes the last kept change when there is one, and leaves the key alone otherwise', () => {
    const undoKey = { key: 'z', [isMac ? 'metaKey' : 'ctrlKey']: true };
    const kept = vi.fn(() => true);
    const { unmount } = renderCommands({ onUndoSuggestion: kept });
    // fireEvent returns false when a listener prevented the event's default.
    expect(fireEvent.keyDown(document.body, undoKey)).toBe(false);
    expect(kept).toHaveBeenCalledTimes(1);
    // ⌘⇧Z is redo, never an undo.
    expect(fireEvent.keyDown(document.body, { ...undoKey, key: 'Z', shiftKey: true })).toBe(true);
    expect(kept).toHaveBeenCalledTimes(1);
    unmount();

    const nothing = vi.fn(() => false);
    renderCommands({ onUndoSuggestion: nothing }, <input aria-label="Feld" />);
    expect(fireEvent.keyDown(document.body, undoKey)).toBe(true);
    expect(nothing).toHaveBeenCalledTimes(1);

    // In a field, ⌘Z is the field's own undo.
    const field = screen.getByRole('textbox', { name: 'Feld' });
    field.focus();
    expect(fireEvent.keyDown(field, undoKey)).toBe(true);
    expect(nothing).toHaveBeenCalledTimes(1);
  });
});
