import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
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

vi.mock('@/i18n/languageContext', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/languageContext')>('@/i18n/languageContext');
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
import { membersApi } from '@/lib/resources';
import { makeMember } from '@/test/fixtures';
import { makeBoard, makeNote } from '@/test/fixtures';
import { TopBar } from './TopBar';

function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const onNewNote = vi.fn();
  renderWithProviders(
    <TopBar
      board={makeBoard()}
      boardId="board-1"
      notes={[]}
      view="wall"
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

/*
 * jsdom has no layout, so these pin the classes that make the bar fit a 375px phone: the
 * left side is the one flex item that shrinks (and the name truncates inside it), the
 * controls sit in a cluster that never shrinks, and nothing in that cluster is hidden.
 * Live, before this, the name's heading was 0px wide and the name ran under the top bar's controls.
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
    renderTopBar();
    const name = screen.getByRole('button', { name: 'My Board' });
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

  it('keeps all four controls in one cluster that never shrinks', () => {
    renderTopBar();
    const controls = [
      screen.getByRole('button', { name: 'Display' }),
      screen.getByRole('button', { name: 'Share board' }),
      screen.getByRole('button', { name: 'New note' }),
      screen.getByRole('button', { name: 'Profile & preferences' }),
    ];

    const cluster = barSlot(screen.getByRole('button', { name: 'Display' }));
    expect(cluster).toHaveClass('shrink-0');
    for (const control of controls) {
      expect(barSlot(control)).toBe(cluster);
      expect(hiddenAncestors(control)).toEqual([]);
    }
    // The name lives in the other, shrinking slot.
    expect(barSlot(screen.getByRole('heading', { level: 1 }))).not.toBe(cluster);
  });
});

describe('independent board layout toggle', () => {
  it('offers List and Board beside Filters without changing grouping', async () => {
    const onSetView = vi.fn();
    const onSetAxis = vi.fn();
    renderTopBar({
      withRail: true,
      axis: 'priority',
      onSetView,
      onSetAxis,
      filters: {
        view: {
          view: 'wall',
          axis: 'priority',
          q: '',
          priority: [],
          mine: false,
          done: true,
          visibility: 'all',
          fieldKey: null,
          fieldValue: null,
          noteId: null,
        },
        setQuery: vi.fn(),
        setPriority: vi.fn(),
        setMine: vi.fn(),
        setDone: vi.fn(),
        setFieldKey: vi.fn(),
        setFieldValue: vi.fn(),
        setVisibility: vi.fn(),
        resetFilters: vi.fn(),
        showVisibility: false,
        fieldKeys: [],
        fieldValues: [],
        isBelowTablet: false,
      },
    });
    const toolbar = screen.getByRole('button', { name: 'Filters' }).parentElement!;
    const layout = within(toolbar).getByRole('group', { name: 'View' });
    expect(within(layout).getByRole('button', { name: 'Board' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(layout).getByRole('button', { name: 'List' }));
    expect(onSetView).toHaveBeenCalledWith('list');
    expect(onSetAxis).not.toHaveBeenCalled();
  });
});

it('opens every accepted contributor and their role from the header overflow', async () => {
  vi.mocked(membersApi.list).mockResolvedValue([
    ...Array.from({ length: 5 }, (_, i) =>
      makeMember({
        id: `member-${i}`,
        userId: `person-${i}`,
        displayName: `Contributor ${i}`,
        role: 'VIEW',
      }),
    ),
    makeMember({ id: 'pending', displayName: 'Pending person', status: 'PENDING' }),
  ]);
  renderTopBar({ isOwner: false, isDesktop: false, isBelowTablet: true });
  const people = await screen.findByRole('button', { name: 'People on this board (5)' });
  await userEvent.click(people);
  expect(await screen.findByText('Contributor 4')).toBeInTheDocument();
  expect(screen.getAllByText('Can view')).toHaveLength(5);
  expect(screen.queryByText('Pending person')).not.toBeInTheDocument();
  expect(screen.queryByText(/online|here now/i)).not.toBeInTheDocument();
});

/*
 * The overdue count compares due dates with today in the browser's calendar. Just after
 * midnight in Germany, UTC is still on the previous day, so a UTC "today" would not yet count
 * yesterday's note as overdue.
 */
describe('TopBar overdue count', () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TZ = 'Europe/Berlin';
    vi.useFakeTimers({ toFake: ['Date'] });
    // 00:30 on 28 October in Berlin (CET, UTC+1) is still 27 October in UTC.
    vi.setSystemTime(new Date('2026-10-27T23:30:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTz;
  });

  it('counts a note due yesterday in local time while UTC is still on that day', () => {
    renderTopBar({
      notes: [
        makeNote({ id: 'note-yesterday', status: 'OPEN', dueDate: '2026-10-27' }),
        makeNote({ id: 'note-today', status: 'OPEN', dueDate: '2026-10-28' }),
      ],
    });

    expect(screen.getByText('1 overdue')).toBeInTheDocument();
  });
});
