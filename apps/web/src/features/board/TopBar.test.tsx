import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return {
    ...actual,
    useAuth: () => ({
      user: { uid: 'user-1', displayName: 'Mika Brandt', email: 'mika@example.com' },
      signOut: vi.fn(),
    }),
  };
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
  membersApi: { list: vi.fn().mockResolvedValue([]) },
}));

import { renderWithProviders } from '@/test/renderWithProviders';
import { makeBoard } from '@/test/fixtures';
import { TopBar } from './TopBar';

function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const onNewNote = vi.fn();
  renderWithProviders(
    <TopBar
      board={makeBoard()}
      boardId="board-1"
      notes={[]}
      view="wand"
      axis="horizon"
      isDesktop
      isBelowTablet={false}
      newNoteVisibility="SHARED"
      isOwner
      isCustomized={false}
      onSetView={vi.fn()}
      onSetAxis={vi.fn()}
      onResetView={vi.fn()}
      onNewNote={onNewNote}
      {...overrides}
    />,
  );
  return { onNewNote };
}

describe('TopBar new-note button', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is labelled "Neue Notiz" when the note would be shared', () => {
    renderTopBar({ newNoteVisibility: 'SHARED' });
    expect(screen.getByRole('button', { name: 'Neue Notiz' })).toBeInTheDocument();
  });

  it('says "Neue private Notiz" when the note would be private, and still creates it', async () => {
    const { onNewNote } = renderTopBar({ newNoteVisibility: 'PRIVATE', isOwner: false });

    await userEvent.click(screen.getByRole('button', { name: 'Neue private Notiz' }));

    expect(onNewNote).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Neue Notiz' })).not.toBeInTheDocument();
  });
});
