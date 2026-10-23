import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { api } from '@/lib/apiClient';
import { AccountSettings } from './AccountPage';
vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn(), deleteWithBody: vi.fn() } }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ signOut: vi.fn(), reauthenticate: vi.fn() }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockResolvedValue({
    ownedBoards: [{ id: 'owned', name: 'Team planning' }],
    recentAuthentication: true,
  });
  vi.mocked(api.deleteWithBody).mockResolvedValue({ status: 'pending' });
});
it('names the owned boards, offers export, and requires explicit typed confirmation', async () => {
  const user = userEvent.setup();
  renderWithProviders(<AccountSettings />);
  expect(await screen.findByText('Team planning')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download my data' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
  await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
  await user.click(screen.getByRole('button', { name: 'Delete my account' }));
  expect(api.deleteWithBody).toHaveBeenCalledWith(
    '/me',
    { confirmation: 'DELETE' },
    expect.anything(),
  );
  expect(await screen.findByRole('status')).toHaveTextContent('Cleanup is still in progress');
});
it('requires sign-in again before allowing deletion with an old session', async () => {
  vi.mocked(api.get).mockResolvedValue({ ownedBoards: [], recentAuthentication: false });
  renderWithProviders(<AccountSettings />);
  expect(await screen.findByRole('button', { name: 'Sign in again' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
});
