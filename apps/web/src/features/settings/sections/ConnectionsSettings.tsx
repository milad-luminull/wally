import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { mcpConnectionSchema, mcpConnectionsSchema } from '@wally/shared';
import { useQueryKeys } from '@/features/board/hooks/queryKeys';
import { api } from '@/lib/apiClient';
import { Button } from '@/components/ui/button';
import { CopyField } from '../CopyField';
import { SettingsGroupTitle, SettingsSection } from '../SettingsSection';

function ConnectionStatus({
  tone,
  children,
}: {
  tone: 'green' | 'gray' | 'red';
  children: ReactNode;
}) {
  const color = { green: 'bg-status-success', gray: 'bg-neutral-400', red: 'bg-status-danger' }[
    tone
  ];
  return (
    <span className="inline-flex items-center gap-2 text-12 text-fg-3">
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
      {children}
    </span>
  );
}

export function ConnectionsSettings() {
  const { t } = useTranslation();
  const keys = useQueryKeys();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: keys.connections(),
    queryFn: () => api.get('/me/connections', mcpConnectionsSchema),
  });
  const mutation = useMutation({
    mutationFn: async (
      change: { kind: 'disconnect'; id: string } | { kind: 'connect'; clientId: string },
    ) =>
      change.kind === 'disconnect'
        ? api.delete(`/me/connections/${change.id}`)
        : api.post('/me/connections/connect', { clientId: change.clientId }, mcpConnectionSchema),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.connections() });
    },
  });
  const data = settings.data;
  const localEndpoint = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(
    import.meta.env.VITE_API_BASE_URL,
  );
  // Keep one visible row per client. Revoked history is retained only for enforcement.
  const clients = [...new Set(data?.connections.map((connection) => connection.clientId) ?? [])];
  const connections = clients.map((clientId) => {
    const rows = data!.connections.filter((connection) => connection.clientId === clientId);
    return rows.find((connection) => !connection.revokedAt) ?? rows[0]!;
  });
  const hasIssue = (connection: (typeof connections)[number]) =>
    !data?.enabled ||
    settings.isError ||
    (mutation.isError &&
      (mutation.variables?.kind === 'disconnect'
        ? mutation.variables.id === connection.id
        : mutation.variables?.clientId === connection.clientId));
  return (
    <SettingsSection id="connections">
      <p className="settings-note mb-4">{t('connections.description')}</p>
      {settings.isPending && (
        <p role="status" className="settings-note">
          {t('connections.loading')}
        </p>
      )}
      {settings.isError && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <ConnectionStatus tone="red">{t('connections.loadError')}</ConnectionStatus>
          <Button variant="outline" onClick={() => void settings.refetch()}>
            {t('connections.retry')}
          </Button>
        </div>
      )}
      {data && (
        <>
          {!data.enabled && <p className="settings-note mb-4">{t('connections.disabled')}</p>}
          {!connections.length && (
            <div className="setting-row">
              <ConnectionStatus tone="gray">{t('connections.none')}</ConnectionStatus>
            </div>
          )}
          <ul>
            {connections.map((connection) => (
              <li key={connection.id} className="setting-row">
                <div className="min-w-0 space-y-1">
                  <h2 className="setting-row-label">{connection.name}</h2>
                  <ConnectionStatus
                    tone={connection.revokedAt || hasIssue(connection) ? 'red' : 'green'}
                  >
                    {t(
                      connection.revokedAt
                        ? 'connections.revoked'
                        : hasIssue(connection)
                          ? 'connections.issue'
                          : 'connections.connected',
                    )}
                  </ConnectionStatus>
                  {connection.revokedAt && (
                    <p className="setting-row-hint">{t('connections.reconnectHint')}</p>
                  )}
                </div>
                <div className="setting-row-control">
                  {!connection.revokedAt ? (
                    <Button
                      variant="outline"
                      disabled={mutation.isPending}
                      aria-label={t('connections.revokeNamed', { name: connection.name })}
                      onClick={() => mutation.mutate({ kind: 'disconnect', id: connection.id })}
                    >
                      {t('connections.revoke')}
                    </Button>
                  ) : (
                    data.enabled &&
                    connection.clientId === data.client?.id && (
                      <Button
                        variant="outline"
                        disabled={mutation.isPending}
                        aria-label={t('connections.reconnectNamed', { name: connection.name })}
                        onClick={() =>
                          mutation.mutate({ kind: 'connect', clientId: connection.clientId })
                        }
                      >
                        {t('connections.reconnect')}
                      </Button>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
          {/* One reserved line for the save result, so nothing below moves. */}
          <div className="mt-2 min-h-[1rem]">
            {mutation.isError ? (
              <p role="alert" className="text-12 text-status-danger">
                {t('connections.saveError')}
              </p>
            ) : (
              <p role="status" className="settings-note">
                {mutation.isPending
                  ? t('connections.saving')
                  : mutation.isSuccess
                    ? t('connections.saved')
                    : ''}
              </p>
            )}
          </div>
          {data.enabled && (
            <section aria-labelledby="connections-setup-title">
              <SettingsGroupTitle id="connections-setup-title">
                {t('connections.setupTitle')}
              </SettingsGroupTitle>
              <ol
                aria-label={t('connections.setupSteps')}
                className="list-decimal space-y-2 pl-5 text-13 leading-relaxed text-fg-3"
              >
                <li>{t('connections.setupOpen')}</li>
                <li>{t(localEndpoint ? 'connections.setupLocalUrl' : 'connections.setupUrl')}</li>
                {data.client && <li>{t('connections.setupClientId')}</li>}
                <li>{t('connections.setupSignIn')}</li>
              </ol>
              {localEndpoint && (
                <p className="settings-note mt-3">{t('connections.localSetupHint')}</p>
              )}
              <div className="mt-5 flex flex-col gap-2">
                <CopyField
                  id="connection-url"
                  label={t('connections.endpoint')}
                  value={`${import.meta.env.VITE_API_BASE_URL}/mcp`}
                />
                {data.client && (
                  <CopyField
                    id="connection-client-id"
                    label={t('connections.clientId')}
                    value={data.client.id}
                  />
                )}
              </div>
            </section>
          )}
        </>
      )}
    </SettingsSection>
  );
}
