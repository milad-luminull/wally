import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useParams } from 'react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/resources', () => ({ boardsApi: { list: vi.fn(), create: vi.fn() } }));
// Imported after the mock so it resolves to the mocked module.
import { boardsApi } from '@/lib/resources';

import { ApiError } from '@/lib/apiClient';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeBoard } from '@/test/fixtures';
import { NewBoardDialog } from './NewBoardDialog';

function Opened() {
  return <p>Opened: {useParams().boardId}</p>;
}

function renderDialog() {
  return renderWithProviders(
    <Routes>
      <Route path="/boards" element={<NewBoardDialog open onOpenChange={() => {}} />} />
      <Route path="/boards/:boardId" element={<Opened />} />
    </Routes>,
    { route: '/boards' },
  );
}

describe('NewBoardDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(boardsApi.list).mockImplementation(() => new Promise(() => {}));
  });

  it('is prefilled with the initial board name and creates on Enter', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.create).mockResolvedValue(makeBoard({ id: 'new-id', name: 'My Board' }));
    renderDialog();

    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('My Board');
    await user.type(name, '{Enter}');

    expect(await screen.findByText('Opened: new-id')).toBeInTheDocument();
    expect(vi.mocked(boardsApi.create).mock.calls[0]![0]).toBe('My Board');
  });

  it('cannot be submitted with a blank name', async () => {
    const user = userEvent.setup();
    renderDialog();
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, '   ');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    await user.type(name, '{Enter}');
    expect(boardsApi.create).not.toHaveBeenCalled();
  });

  it('says so when the board limit is reached', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.create).mockRejectedValue(
      new ApiError(422, { error: 'BOARD_LIMIT_REACHED', message: 'limit' }),
    );
    renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You have reached the limit of 20 boards.',
    );
  });

  // A lost response followed by a second click must replay the first request, not create a
  // second board.
  it('retries with the same operation id', async () => {
    const user = userEvent.setup();
    vi.mocked(boardsApi.create)
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockResolvedValueOnce(makeBoard({ id: 'new-id' }));
    renderDialog();

    await user.click(await screen.findByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t create the board.');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(boardsApi.create).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(boardsApi.create).mock.calls;
    expect(second![1]!.operationId).toBe(first![1]!.operationId);
    expect(await screen.findByText('Opened: new-id')).toBeInTheDocument();
  });
});
