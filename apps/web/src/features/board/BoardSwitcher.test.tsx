import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/resources', () => ({ boardsApi: { list: vi.fn(), create: vi.fn() } }));
// Imported after the mock so it resolves to the mocked module.
import { boardsApi } from '@/lib/resources';

import { renderWithProviders } from '@/test/renderWithProviders';
import { makeBoard } from '@/test/fixtures';
import { BoardSwitcher } from './BoardSwitcher';

describe('BoardSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // RFC BOARD_HOME §11: even with one board, the switcher is the way to the board home and
  // the only hint on a board that more boards are possible.
  it('offers all boards and a new board even when the caller has only one', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.list).mockResolvedValue([makeBoard({ id: 'own' })]);

    renderWithProviders(<BoardSwitcher boardId="own" />, { route: '/boards/own' });
    await user.click(await screen.findByRole('button', { name: 'Switch board' }));

    expect(screen.getByRole('link', { name: 'All boards' })).toHaveAttribute('href', '/boards');
    await user.click(screen.getByRole('button', { name: 'New board' }));
    expect(await screen.findByRole('dialog', { name: 'New board' })).toBeInTheDocument();
  }, 60_000);

  /**
   * Until this existed, useBoards was consumed only by RootRedirect — which always prefers
   * the board you own — so a colleague whose invite had just activated landed on their own
   * empty wall with no route to the shared board, and no invite email carrying a link.
   */
  it('offers the boards the caller does not own, marking the current one', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.list).mockResolvedValue([
      makeBoard({ id: 'own', name: 'Meine Wand', currentUserRole: 'OWNER' }),
      makeBoard({ id: 'shared', name: 'Team Nord', currentUserRole: 'EDIT' }),
    ]);

    renderWithProviders(<BoardSwitcher boardId="own" />, { route: '/boards/own' });

    await user.click(await screen.findByRole('button', { name: 'Switch board' }));

    expect(screen.getByRole('link', { name: /Team Nord/ })).toHaveAttribute(
      'href',
      '/boards/shared',
    );
    // aria-current is how a screen reader tells the two apart; the check mark is decorative.
    expect(screen.getByRole('link', { name: /Meine Wand/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('names the role the caller holds on each board', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.list).mockResolvedValue([
      makeBoard({ id: 'own', name: 'Meine Wand', currentUserRole: 'OWNER' }),
      makeBoard({ id: 'shared', name: 'Team Nord', currentUserRole: 'VIEW' }),
    ]);

    renderWithProviders(<BoardSwitcher boardId="own" />, { route: '/boards/own' });
    await user.click(await screen.findByRole('button', { name: 'Switch board' }));

    // A read-only board looking identical to an editable one is the kind of thing people
    // only discover by trying to type into it.
    expect(screen.getByText('Can view')).toBeInTheDocument();
    expect(screen.getByText('Your board')).toBeInTheDocument();
  });
});
