import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
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
}));

import { renderWithProviders } from '@/test/renderWithProviders';
import { isMac } from '@/lib/shortcuts';
import { BoardCommands } from './BoardCommands';

const PALETTE = isMac ? '{Meta>}k{/Meta}' : '{Control>}k{/Control}';
const MOD = isMac ? '{Meta>}d{/Meta}' : '{Control>}d{/Control}';

function renderCommands(overrides: Partial<Parameters<typeof BoardCommands>[0]> = {}) {
  const onDuplicateNote = vi.fn();
  const onNewNote = vi.fn();
  renderWithProviders(
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
      {...overrides}
    />,
  );
  return { onDuplicateNote, onNewNote };
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
});
