import { beforeEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { api } from '@/lib/apiClient';
import { ConnectionsSettings } from './ConnectionsPage';
import type { McpConnections } from '@wally/shared';
vi.mock('@/lib/resources', () => ({ boardsApi: { list: vi.fn(async () => []) } }));
vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const connection: McpConnections['connections'][number] = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'ChatGPT',
  clientId: 'client',
  scopes: ['wally:read', 'wally:write'],
  createdAt: '2026-10-19T00:00:00.000Z',
  revokedAt: null,
};
let config: McpConnections;
beforeEach(() => {
  vi.resetAllMocks();
  config = {
    enabled: true,
    writesEnabled: true,
    client: { id: 'client', name: 'ChatGPT' },
    connections: [],
  };
  vi.mocked(api.get).mockImplementation(async () => config);
  vi.mocked(api.post).mockImplementation(async () => {
    config = { ...config, connections: [connection] };
    return connection;
  });
  vi.mocked(api.delete).mockImplementation(async () => {
    config = { ...config, connections: [{ ...connection, revokedAt: '2026-10-22T10:00:00.000Z' }] };
  });
});
it('explains OAuth connection without board selection or owner switches', async () => {
  renderWithProviders(<ConnectionsSettings />);
  expect(
    await screen.findByRole('heading', { name: 'Connected apps', level: 1 }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/sign in with your Wally account/i)).toBeInTheDocument();
});
it('shows ordinary permissions and only Disconnect for an active account-wide connection', async () => {
  config.connections = [connection];
  const user = userEvent.setup();
  renderWithProviders(<ConnectionsSettings />);
  await user.click(await screen.findByRole('button', { name: 'Disconnect ChatGPT' }));
  await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`/me/connections/${connection.id}`));
  expect(await screen.findByRole('button', { name: 'Reconnect ChatGPT' })).toBeInTheDocument();
});
it('does not show old revoked entries alongside an active replacement', async () => {
  config.connections = [
    {
      ...connection,
      id: '00000000-0000-4000-8000-000000000002',
      revokedAt: '2026-10-20T00:00:00.000Z',
    },
    connection,
  ];
  renderWithProviders(<ConnectionsSettings />);
  expect(await screen.findByRole('button', { name: 'Disconnect ChatGPT' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reconnect ChatGPT' })).not.toBeInTheDocument();
});
it('keeps Disconnect available when rollout is disabled', async () => {
  config.enabled = false;
  config.connections = [connection];
  renderWithProviders(<ConnectionsSettings />);
  expect(await screen.findByRole('button', { name: 'Disconnect ChatGPT' })).toBeEnabled();
});
it('shows a recoverable load error', async () => {
  vi.mocked(api.get).mockRejectedValue(new Error('network'));
  renderWithProviders(<ConnectionsSettings />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load connections');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

it('reports a failed disconnect without hiding the active connection', async () => {
  config.connections = [connection];
  vi.mocked(api.delete).mockRejectedValue(new Error('network'));
  const user = userEvent.setup();
  renderWithProviders(<ConnectionsSettings />);
  await user.click(await screen.findByRole('button', { name: 'Disconnect ChatGPT' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save this change');
  expect(screen.getByText('Connection issue')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Disconnect ChatGPT' })).toBeEnabled();
});

it('shows a gray not-connected state and numbered setup steps', async () => {
  renderWithProviders(<ConnectionsSettings />);
  expect(await screen.findByText('Not connected')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Connection setup steps' }).children).toHaveLength(3);
});
it('shows disconnected as an issue and keeps reconnect available', async () => {
  config.connections = [{ ...connection, revokedAt: '2026-10-22T10:00:00.000Z' }];
  renderWithProviders(<ConnectionsSettings />);
  expect(await screen.findByText('Disconnected')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reconnect ChatGPT' })).toBeEnabled();
});
