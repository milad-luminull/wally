import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { mcpConnectionSchema, mcpConnectionsSchema } from '@wally/shared';
import { HomeShell } from '@/features/boards/HomeShell';
import { useQueryKeys } from '@/features/board/hooks/queryKeys';
import { api } from '@/lib/apiClient';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

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
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
      <div className="space-y-3">
        <Link to="/boards" className="text-13 text-fg-3 underline underline-offset-4">
          {t('connections.back')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-fg-1">
          {t('connections.title')}
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-fg-3">{t('connections.description')}</p>
      </div>
      {settings.isPending && <p role="status">{t('connections.loading')}</p>}
      {settings.isError && (
        <div role="alert" className="space-y-3">
          <p>{t('connections.loadError')}</p>
          <Button variant="outline" onClick={() => void settings.refetch()}>
            {t('connections.retry')}
          </Button>
        </div>
      )}
      {data && (
        <>
          {!data.enabled && (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-3">
              {t('connections.disabled')}
            </p>
          )}
          {!connections.length && <p className="text-sm text-fg-3">{t('connections.none')}</p>}
          <ul className="space-y-3">
            {connections.map((connection) => (
              <li
                key={connection.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <h2 className="font-medium">{connection.name}</h2>
                  <p className="text-sm text-fg-3">
                    {t(connection.revokedAt ? 'connections.revoked' : 'connections.inherited')}
                  </p>
                </div>
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
              </li>
            ))}
          </ul>
          {mutation.isError && (
            <p role="alert" className="text-sm text-status-danger">
              {t('connections.saveError')}
            </p>
          )}
          <p role="status" className="text-sm text-fg-3">
            {mutation.isPending
              ? t('connections.saving')
              : mutation.isSuccess
                ? t('connections.saved')
                : ''}
          </p>
          {data.enabled && (
            <section
              aria-labelledby="connections-setup-title"
              className="space-y-3 border-t border-border pt-6"
            >
              <h2 id="connections-setup-title" className="text-base font-semibold">
                {t('connections.setupTitle')}
              </h2>
              <p className="text-sm leading-relaxed text-fg-3">
                {t(localEndpoint ? 'connections.localSetupHint' : 'connections.setupHint')}
              </p>
              <Label htmlFor="connection-url">{t('connections.endpoint')}</Label>
              <Input
                id="connection-url"
                readOnly
                value={`${import.meta.env.VITE_API_BASE_URL}/mcp`}
                onFocus={(event) => event.currentTarget.select()}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
export function ConnectionsPage() {
  return (
    <HomeShell>
      <ConnectionsSettings />
    </HomeShell>
  );
}
