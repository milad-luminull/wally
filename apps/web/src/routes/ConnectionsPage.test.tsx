import { beforeEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { api } from '@/lib/apiClient';
import { boardsApi } from '@/lib/resources';
import { ConnectionsSettings } from './ConnectionsPage';
import type { McpConnections } from '@wally/shared';
vi.mock('@/lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/resources', () => ({ boardsApi: { list: vi.fn() } }));
const active: McpConnections['connections'][number] = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'ChatGPT',
  clientId: 'client',
  boardIds: ['one'],
  scopes: ['wally:read'],
  createdAt: '2026-10-19T00:00:00.000Z',
  revokedAt: null,
};
let config: {
  enabled: boolean;
  writesEnabled: boolean;
  client: { id: string; name: string };
  connections: (typeof active)[];
};
beforeEach(() => {
  vi.resetAllMocks();
  config = {
    enabled: true,
    writesEnabled: false,
    client: { id: 'client', name: 'ChatGPT' },
    connections: [],
  };
  vi.mocked(boardsApi.list).mockResolvedValue([
    { id: 'one', name: 'My board', currentUserRole: 'OWNER' },
    { id: 'shared', name: 'Shared board', currentUserRole: 'VIEW' },
  ]);
  vi.mocked(api.get).mockImplementation(async (path) =>
    path === '/me/connections' ? config : { enabled: true },
  );
  vi.mocked(api.post).mockImplementation(async () => {
    config = { ...config, connections: [active] };
    return active;
  });
  vi.mocked(api.patch).mockResolvedValue({ enabled: false });
  vi.mocked(api.delete).mockImplementation(async () => {
    config = {
      ...config,
      connections: [{ ...active, revokedAt: '2026-10-19T01:00:00.000Z' } as typeof active],
    };
  });
});
it('requires selected boards and defaults consent to read-only', async () => {
  const user = userEvent.setup();
  renderWithProviders(<ConnectionsSettings />);
  const approve = await screen.findByRole('button', { name: 'Approve selected boards' });
  expect(approve).toBeDisabled();
  expect(screen.queryByRole('checkbox', { name: 'Allow changes' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: 'Select My board' }));
  await user.click(approve);
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/me/connections',
      { clientId: 'client', boardIds: ['one'], write: false },
      expect.anything(),
    ),
  );
  expect(await screen.findByRole('button', { name: 'Revoke ChatGPT' })).toBeInTheDocument();
});
it('only owners can change board policy', async () => {
  const user = userEvent.setup();
  renderWithProviders(<ConnectionsSettings />);
  await user.click(await screen.findByRole('switch', { name: 'External AI access for My board' }));
  expect(
    screen.queryByRole('switch', { name: 'External AI access for Shared board' }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith(
      '/whiteboards/one/mcp-access',
      { enabled: false },
      expect.anything(),
    ),
  );
});
it('shows disabled configuration without offering approval', async () => {
  config.enabled = false;
  renderWithProviders(<ConnectionsSettings />);
  expect(
    await screen.findByText('External AI connections are not enabled for this deployment.'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve selected boards' })).not.toBeInTheDocument();
});
it('revokes existing access even when new connections are disabled', async () => {
  config.enabled = false;
  config.connections = [active];
  const user = userEvent.setup();
  renderWithProviders(<ConnectionsSettings />);
  await user.click(await screen.findByRole('button', { name: 'Revoke ChatGPT' }));
  await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`/me/connections/${active.id}`));
  expect(await screen.findByText(/Revoked/)).toBeInTheDocument();
});
it('shows a recoverable error when settings cannot load', async () => {
  vi.mocked(api.get).mockRejectedValue(new Error('offline'));
  renderWithProviders(<ConnectionsSettings />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load connections.');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
it('offers write consent only when deployment allows it and blocks view-only boards', async () => {
  config.writesEnabled = true;
  const user = userEvent.setup();
  renderWithProviders(<ConnectionsSettings />);
  const write = await screen.findByRole('checkbox', { name: 'Allow changes' });
  expect(write).not.toBeChecked();
  await user.click(write);
  expect(screen.getByRole('checkbox', { name: 'Select Shared board' })).toBeDisabled();
});

it('keeps revoke available when a board policy cannot load and blocks that board selection', async () => {
  config.connections = [active];
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/me/connections') return config;
    if (path.includes('/one/')) throw new Error('board unavailable');
    return { enabled: true };
  });
  const user = userEvent.setup();
  renderWithProviders(<ConnectionsSettings />);
  const revoke = await screen.findByRole('button', { name: 'Revoke ChatGPT' });
  await screen.findByText(
    'Could not load board access. Existing connections can still be revoked.',
  );
  expect(screen.getByRole('checkbox', { name: 'Select My board' })).toBeDisabled();
  await user.click(revoke);
  await waitFor(() => expect(api.delete).toHaveBeenCalled());
});

it('shows a failed save and keeps selected consent for a retry', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error('forbidden'));
  const user = userEvent.setup();
  renderWithProviders(<ConnectionsSettings />);
  const board = await screen.findByRole('checkbox', { name: 'Select My board' });
  await waitFor(() => expect(board).not.toBeDisabled());
  await user.click(board);
  await user.click(screen.getByRole('button', { name: 'Approve selected boards' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this change.');
  expect(board).toBeChecked();
  expect(screen.getByRole('button', { name: 'Approve selected boards' })).not.toBeDisabled();
});
