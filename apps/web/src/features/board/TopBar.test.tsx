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
      language: 'en',
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
      assistantEnabled={false}
      onOpenAssistant={vi.fn()}
      {...overrides}
    />,
  );
  return { onNewNote };
}

describe('TopBar new-note button', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is labelled "New note" when the note would be shared', () => {
    renderTopBar({ newNoteVisibility: 'SHARED' });
    expect(screen.getByRole('button', { name: 'New note' })).toBeInTheDocument();
  });

  it('says "New private note" when the note would be private, and still creates it', async () => {
    const { onNewNote } = renderTopBar({ newNoteVisibility: 'PRIVATE', isOwner: false });

    await userEvent.click(screen.getByRole('button', { name: 'New private note' }));

    expect(onNewNote).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'New note' })).not.toBeInTheDocument();
  });
});

describe('TopBar question button', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is absent when the assistant is off', () => {
    renderTopBar({ assistantEnabled: false });
    expect(screen.queryByRole('button', { name: 'Ask' })).not.toBeInTheDocument();
  });

  it('shows at every width when the assistant is on and opens the panel on click', async () => {
    const onOpenAssistant = vi.fn();
    renderTopBar({ assistantEnabled: true, onOpenAssistant });
    const button = screen.getByRole('button', { name: 'Ask' });
    expect(button).not.toHaveClass('hidden');
    await userEvent.click(button);
    expect(onOpenAssistant).toHaveBeenCalledTimes(1);
  });
});

/*
 * jsdom has no layout, so these pin the classes that make the bar fit a 375px phone: the
 * left side is the one flex item that shrinks (and the name truncates inside it), the
 * controls sit in a cluster that never shrinks, and nothing in that cluster is hidden.
 * Live, before this, the name's heading was 0px wide and the name ran under the Ask button.
 */
describe('TopBar at phone width', () => {
  beforeEach(() => vi.clearAllMocks());

  /** The element that is a direct child of the header and contains `el`. */
  function barSlot(el: HTMLElement): HTMLElement {
    const header = el.closest('header');
    let node: HTMLElement = el;
    while (node.parentElement && node.parentElement !== header) node = node.parentElement;
    return node;
  }

  function hiddenAncestors(el: HTMLElement): HTMLElement[] {
    const found: HTMLElement[] = [];
    for (let n: HTMLElement | null = el; n && n.tagName !== 'HEADER'; n = n.parentElement) {
      if (n.classList.contains('hidden')) found.push(n);
    }
    return found;
  }

  it('lets the board name shrink and truncate instead of running under the controls', () => {
    renderTopBar({ assistantEnabled: true });
    const name = screen.getByRole('button', { name: 'Meine Wand' });
    const heading = screen.getByRole('heading', { level: 1 });

    expect(name).toHaveClass('truncate', 'max-w-full');
    // A block button sizes to its content, so the cap must sit on the heading.
    expect(name).not.toHaveClass('max-w-[260px]');
    expect(heading).toHaveClass('min-w-0', 'max-w-[260px]');
    expect(barSlot(heading)).toHaveClass('min-w-0', 'flex-1');
  });

  it('truncates a viewer’s board name the same way', () => {
    renderTopBar({ isOwner: false });
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.firstElementChild).toHaveClass('truncate', 'max-w-full');
    expect(barSlot(heading)).toHaveClass('min-w-0', 'flex-1');
  });

  it('keeps all five controls, Ask included, in one cluster that never shrinks', () => {
    renderTopBar({ assistantEnabled: true });
    const ask = screen.getByRole('button', { name: 'Ask' });
    const controls = [
      ask,
      screen.getByRole('button', { name: 'Display' }),
      screen.getByRole('button', { name: 'Share' }),
      screen.getByRole('button', { name: 'New note' }),
      screen.getByRole('button', { name: 'Account' }),
    ];

    const cluster = barSlot(ask);
    expect(cluster).toHaveClass('shrink-0');
    for (const control of controls) {
      expect(barSlot(control)).toBe(cluster);
      expect(hiddenAncestors(control)).toEqual([]);
    }
    // The name lives in the other, shrinking slot.
    expect(barSlot(screen.getByRole('heading', { level: 1 }))).not.toBe(cluster);
  });
});
