import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_PREFERENCES, type MeDto, type WhiteboardSummaryDto } from '@wally/shared';

vi.mock('@/lib/resources', () => ({
  boardsApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn(), leave: vi.fn() },
  meApi: { get: vi.fn() },
  notesApi: { list: vi.fn() },
}));
vi.mock('@/features/auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth/AuthProvider')>(
    '@/features/auth/AuthProvider',
  );
  return { ...actual, useAuth: () => ({ status: 'authenticated' }) };
});
// Imported after the mocks so they resolve to the mocked modules.
import { boardsApi, meApi, notesApi } from '@/lib/resources';

import { renderWithProviders } from '@/test/renderWithProviders';
import { makeBoard, makeNote } from '@/test/fixtures';
import { BoardHome } from './BoardHome';

const zeta: WhiteboardSummaryDto = { id: 'zeta', name: 'Zeta', currentUserRole: 'OWNER' };
const alpha: WhiteboardSummaryDto = { id: 'alpha', name: 'Alpha', currentUserRole: 'OWNER' };
const beta: WhiteboardSummaryDto = { id: 'beta', name: 'Beta', currentUserRole: 'VIEW' };

function me(lastBoardId: string | null): MeDto {
  return {
    id: 'u-1',
    email: 'max@example.com',
    displayName: null,
    language: 'en',
    preferences: { ...DEFAULT_PREFERENCES, lastBoardId },
  } as MeDto;
}

function renderHome(boards: WhiteboardSummaryDto[], lastBoardId: string | null = null) {
  vi.mocked(boardsApi.list).mockResolvedValue(boards);
  vi.mocked(meApi.get).mockResolvedValue(me(lastBoardId));
  return renderWithProviders(<BoardHome />, { route: '/boards' });
}

const rowLinks = () =>
  screen.getAllByRole('link', { name: /^Open / }).map((link) => link.getAttribute('aria-label'));

describe('BoardHome', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lists own boards first, then shared ones with their role, each group by name', async () => {
    renderHome([zeta, beta, alpha]);
    await screen.findByRole('heading', { level: 1, name: 'Your boards' });
    await waitFor(() =>
      expect(rowLinks()).toEqual(['Open Alpha', 'Open Zeta', 'Open Beta, Can view']),
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Shared with you' })).toBeInTheDocument();
    // A screen reader announces the role too, not only the sighted user's label.
    const betaRow = screen.getByRole('link', { name: 'Open Beta, Can view' });
    expect(betaRow).toHaveTextContent('Can view');
    expect(betaRow).toHaveAttribute('href', '/boards/beta');
  });

  it('offers to continue on the remembered board when it is on the list', async () => {
    renderHome([alpha, beta], 'beta');
    const card = await screen.findByRole('link', { name: /Continue/ });
    expect(card).toHaveTextContent('Beta');
    expect(card).toHaveAttribute('href', '/boards/beta');
  });

  // The continue card sits above the list. Painting the list first and the card a moment later
  // shifts every row down under the pointer.
  it('waits for the profile before showing the boards, so the continue card does not pop in', async () => {
    let resolveMe: (value: MeDto) => void = () => {};
    vi.mocked(boardsApi.list).mockResolvedValue([alpha, beta]);
    vi.mocked(meApi.get).mockReturnValue(new Promise((resolve) => (resolveMe = resolve)));
    renderWithProviders(<BoardHome />, { route: '/boards' });

    await waitFor(() => expect(boardsApi.list).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('link', { name: /Alpha/ })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();

    resolveMe(me('beta'));
    expect(await screen.findByRole('link', { name: /Continue/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alpha/ })).toBeInTheDocument();
  });

  it('shows the boards without a continue card when the profile cannot be loaded', async () => {
    vi.mocked(boardsApi.list).mockResolvedValue([alpha]);
    vi.mocked(meApi.get).mockRejectedValue(new Error('offline'));
    renderWithProviders(<BoardHome />, { route: '/boards' });
    expect(await screen.findByRole('link', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.queryByText('Continue')).not.toBeInTheDocument();
  });

  it('shows no continue card when the remembered board is gone', async () => {
    renderHome([alpha, beta], 'deleted-meanwhile');
    await screen.findByRole('link', { name: 'Open Alpha' });
    expect(screen.queryByText('Continue')).not.toBeInTheDocument();
  });

  it('shows an empty state with a way to create the first board', async () => {
    renderHome([]);
    expect(await screen.findByText('No boards yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New board' }).length).toBeGreaterThan(0);
  });

  it('offers delete on own boards and leave on shared ones, never both', async () => {
    const user = userEvent.setup();
    renderHome([alpha, beta]);

    await user.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    expect(await screen.findByRole('button', { name: 'Delete board' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leave board' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Options for Beta' }));
    expect(await screen.findByRole('button', { name: 'Leave board' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete board' })).not.toBeInTheDocument();
  }, 60_000);

  it('confirms a deletion with the board name and note count before deleting', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.get).mockResolvedValue(makeBoard({ id: 'alpha', revision: 4 }));
    vi.mocked(notesApi.list).mockResolvedValue([makeNote(), makeNote(), makeNote()]);
    vi.mocked(boardsApi.remove).mockResolvedValue(undefined);
    renderHome([alpha, beta]);

    await user.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    await user.click(await screen.findByRole('button', { name: 'Delete board' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete “Alpha”?')).toBeInTheDocument();
    expect(await within(dialog).findByText(/its 3 notes/)).toBeInTheDocument();
    expect(boardsApi.remove).not.toHaveBeenCalled();

    // From here the server no longer lists it, for the refetch after the deletion settles.
    vi.mocked(boardsApi.list).mockResolvedValue([beta]);
    await user.click(within(dialog).getByRole('button', { name: 'Delete board' }));
    await waitFor(() => expect(boardsApi.remove).toHaveBeenCalled());
    expect(vi.mocked(boardsApi.remove).mock.calls[0]![0]).toBe('alpha');
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Open Alpha' })).not.toBeInTheDocument(),
    );
  }, 60_000);

  it('confirms leaving a shared board before leaving it', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.leave).mockResolvedValue(undefined);
    renderHome([alpha, beta]);

    await user.click(await screen.findByRole('button', { name: 'Options for Beta' }));
    await user.click(await screen.findByRole('button', { name: 'Leave board' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Leave “Beta”?')).toBeInTheDocument();
    // It says what becomes of their assignments, not only that their access ends.
    expect(
      within(dialog).getByText(/Notes assigned to you on this board are unassigned\./),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Leave board' }));
    await waitFor(() => expect(boardsApi.leave).toHaveBeenCalledWith('beta'));
  }, 60_000);
});

describe('BoardHome focus after a confirmation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // The row and its menu button are gone after a delete; focus must land somewhere a keyboard
  // user can continue from, not on <body>.
  it('moves focus to the page heading once the board is gone', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.get).mockResolvedValue(makeBoard({ id: 'alpha', revision: 4 }));
    vi.mocked(notesApi.list).mockResolvedValue([]);
    vi.mocked(boardsApi.remove).mockResolvedValue(undefined);
    renderHome([alpha, beta]);

    await user.click(await screen.findByRole('button', { name: 'Options for Alpha' }));
    await user.click(await screen.findByRole('button', { name: 'Delete board' }));
    const dialog = await screen.findByRole('alertdialog');
    vi.mocked(boardsApi.list).mockResolvedValue([beta]);
    await user.click(within(dialog).getByRole('button', { name: 'Delete board' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Your boards' })).toHaveFocus(),
    );
  }, 60_000);

  it('returns focus to the row’s menu button when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderHome([alpha, beta]);

    const trigger = await screen.findByRole('button', { name: 'Options for Beta' });
    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Leave board' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(trigger).toHaveFocus());
  }, 60_000);
});
