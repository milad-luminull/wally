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
    language: 'de',
    preferences: { ...DEFAULT_PREFERENCES, lastBoardId },
  } as MeDto;
}

function renderHome(boards: WhiteboardSummaryDto[], lastBoardId: string | null = null) {
  vi.mocked(boardsApi.list).mockResolvedValue(boards);
  vi.mocked(meApi.get).mockResolvedValue(me(lastBoardId));
  return renderWithProviders(<BoardHome />, { route: '/boards' });
}

const rowLinks = () =>
  screen.getAllByRole('link', { name: / öffnen$/ }).map((link) => link.getAttribute('aria-label'));

describe('BoardHome', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lists own boards first, then shared ones with their role, each group by name', async () => {
    renderHome([zeta, beta, alpha]);
    await screen.findByRole('heading', { level: 1, name: 'Deine Wände' });
    await waitFor(() => expect(rowLinks()).toEqual(['Alpha öffnen', 'Zeta öffnen', 'Beta öffnen']));
    expect(screen.getByRole('heading', { level: 2, name: 'Mit dir geteilt' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Beta öffnen' })).toHaveTextContent('Ansehen');
    expect(screen.getByRole('link', { name: 'Beta öffnen' })).toHaveAttribute(
      'href',
      '/boards/beta',
    );
  });

  it('offers to continue on the remembered board when it is on the list', async () => {
    renderHome([alpha, beta], 'beta');
    const card = await screen.findByRole('link', { name: /Weitermachen/ });
    expect(card).toHaveTextContent('Beta');
    expect(card).toHaveAttribute('href', '/boards/beta');
  });

  it('shows no continue card when the remembered board is gone', async () => {
    renderHome([alpha, beta], 'deleted-meanwhile');
    await screen.findByRole('link', { name: 'Alpha öffnen' });
    expect(screen.queryByText('Weitermachen')).not.toBeInTheDocument();
  });

  it('shows an empty state with a way to create the first board', async () => {
    renderHome([]);
    expect(await screen.findByText('Noch keine Wände')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Neue Wand' }).length).toBeGreaterThan(0);
  });

  it('offers delete on own boards and leave on shared ones, never both', async () => {
    const user = userEvent.setup();
    renderHome([alpha, beta]);

    await user.click(await screen.findByRole('button', { name: 'Optionen für Alpha' }));
    expect(await screen.findByRole('button', { name: 'Wand löschen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wand verlassen' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Optionen für Beta' }));
    expect(await screen.findByRole('button', { name: 'Wand verlassen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wand löschen' })).not.toBeInTheDocument();
  }, 60_000);

  it('confirms a deletion with the board name and note count before deleting', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.get).mockResolvedValue(makeBoard({ id: 'alpha', revision: 4 }));
    vi.mocked(notesApi.list).mockResolvedValue([makeNote(), makeNote(), makeNote()]);
    vi.mocked(boardsApi.remove).mockResolvedValue(undefined);
    renderHome([alpha, beta]);

    await user.click(await screen.findByRole('button', { name: 'Optionen für Alpha' }));
    await user.click(await screen.findByRole('button', { name: 'Wand löschen' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('„Alpha“ löschen?')).toBeInTheDocument();
    expect(await within(dialog).findByText(/ihre 3 Notizen/)).toBeInTheDocument();
    expect(boardsApi.remove).not.toHaveBeenCalled();

    // From here the server no longer lists it, for the refetch after the deletion settles.
    vi.mocked(boardsApi.list).mockResolvedValue([beta]);
    await user.click(within(dialog).getByRole('button', { name: 'Wand löschen' }));
    await waitFor(() => expect(boardsApi.remove).toHaveBeenCalled());
    expect(vi.mocked(boardsApi.remove).mock.calls[0]![0]).toBe('alpha');
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Alpha öffnen' })).not.toBeInTheDocument(),
    );
  }, 60_000);

  it('confirms leaving a shared board before leaving it', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.leave).mockResolvedValue(undefined);
    renderHome([alpha, beta]);

    await user.click(await screen.findByRole('button', { name: 'Optionen für Beta' }));
    await user.click(await screen.findByRole('button', { name: 'Wand verlassen' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('„Beta“ verlassen?')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Wand verlassen' }));
    await waitFor(() => expect(boardsApi.leave).toHaveBeenCalledWith('beta'));
  }, 60_000);
});
