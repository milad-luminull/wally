import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { screen } from '@testing-library/react';
import type { WhiteboardSummaryDto } from '@wally/shared';

vi.mock('@/lib/resources', () => ({ boardsApi: { list: vi.fn() } }));
// Imported after the mock so it resolves to the mocked module.
import { boardsApi } from '@/lib/resources';

import { renderWithProviders } from '@/test/renderWithProviders';
import { BoardEntryPage } from './BoardEntryPage';

/** Prints where the board entry sent the caller, so each redirect is observable. */
function Where() {
  const location = useLocation();
  return <p>Target: {location.pathname + location.search}</p>;
}

function renderEntry(state?: unknown) {
  return renderWithProviders(
    <Routes>
      <Route path="/app" element={<BoardEntryPage />} />
      <Route path="/boards" element={<Where />} />
      <Route path="/boards/:boardId" element={<Where />} />
      <Route path="/share/:token" element={<Where />} />
    </Routes>,
    { route: '/app', state },
  );
}

const own: WhiteboardSummaryDto = { id: 'own', name: 'My Board', currentUserRole: 'OWNER' };
const shared: WhiteboardSummaryDto = { id: 'shared', name: 'Team North', currentUserRole: 'EDIT' };

describe('BoardEntryPage', () => {
  beforeEach(() => {
    vi.mocked(boardsApi.list).mockReset();
  });

  it('goes straight into the one board a single-board user has', async () => {
    vi.mocked(boardsApi.list).mockResolvedValue([own]);
    renderEntry();
    expect(await screen.findByText('Target: /boards/own')).toBeInTheDocument();
  });

  it('goes to the board home with two or more boards', async () => {
    vi.mocked(boardsApi.list).mockResolvedValue([own, shared]);
    renderEntry();
    expect(await screen.findByText('Target: /boards')).toBeInTheDocument();
  });

  it('goes to the board home with no boards at all', async () => {
    vi.mocked(boardsApi.list).mockResolvedValue([]);
    renderEntry();
    expect(await screen.findByText('Target: /boards')).toBeInTheDocument();
  });

  it('follows a share link the visitor arrived with', async () => {
    vi.mocked(boardsApi.list).mockResolvedValue([own]);
    renderEntry({ to: '/share/tok-1' });
    expect(await screen.findByText('Target: /share/tok-1')).toBeInTheDocument();
  });

  it('follows a board path the caller can open, keeping its query string', async () => {
    vi.mocked(boardsApi.list).mockResolvedValue([own, shared]);
    renderEntry({ to: '/boards/shared?view=list' });
    expect(await screen.findByText('Target: /boards/shared?view=list')).toBeInTheDocument();
  });

  // The bug this page exists to fix: a board from the previous account, or any board the new
  // caller cannot see, must never be the place sign-in lands on.
  it('drops a board path the caller cannot open', async () => {
    vi.mocked(boardsApi.list).mockResolvedValue([own]);
    renderEntry({ to: '/boards/someone-elses' });
    expect(await screen.findByText('Target: /boards/own')).toBeInTheDocument();
  });

  it('drops a return path that is not an in-app path', async () => {
    vi.mocked(boardsApi.list).mockResolvedValue([own, shared]);
    renderEntry({ to: 'https://evil.example/boards/own' });
    expect(await screen.findByText('Target: /boards')).toBeInTheDocument();
  });

  it('offers a retry when the board list cannot be loaded', async () => {
    vi.mocked(boardsApi.list).mockRejectedValue(new Error('offline'));
    renderEntry();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // It loads the list of boards, not one board.
    expect(screen.getByText('Couldn’t load your boards')).toBeInTheDocument();
  });
});
