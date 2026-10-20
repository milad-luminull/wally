import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { mcpBoardPolicySchema, mcpConnectionSchema, mcpConnectionsSchema } from '@wally/shared';
import { HomeShell } from '@/features/boards/HomeShell';
import { useBoards } from '@/features/board/hooks/useBoards';
import { useQueryKeys } from '@/features/board/hooks/queryKeys';
import { api } from '@/lib/apiClient';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

type Change =
  | { kind: 'policy'; boardId: string; enabled: boolean }
  | { kind: 'grant' }
  | { kind: 'revoke'; id: string };

export function ConnectionsSettings() {
  const { t } = useTranslation();
  const keys = useQueryKeys();
  const queryClient = useQueryClient();
  const boards = useBoards();
  const settings = useQuery({
    queryKey: keys.connections(),
    queryFn: () => api.get('/me/connections', mcpConnectionsSchema),
  });
  const list = boards.data ?? [];
  const policies = useQueries({
    queries: list.map((board) => ({
      queryKey: keys.mcpBoardPolicy(board.id),
      queryFn: () =>
        api.get(`/whiteboards/${encodeURIComponent(board.id)}/mcp-access`, mcpBoardPolicySchema),
    })),
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [write, setWrite] = useState(false);
  const [saved, setSaved] = useState(false);
  const effectiveWrite = write && settings.data?.writesEnabled === true;
  const eligible = list.filter(
    (board, index) =>
      policies[index]?.data?.enabled &&
      !policies[index]?.isError &&
      (!effectiveWrite || board.currentUserRole !== 'VIEW'),
  );
  const boardIds = selected.filter((id) => eligible.some((board) => board.id === id));
  const mutation = useMutation({
    mutationFn: async (change: Change) => {
      setSaved(false);
      if (change.kind === 'policy')
        return api.patch(
          `/whiteboards/${encodeURIComponent(change.boardId)}/mcp-access`,
          { enabled: change.enabled },
          mcpBoardPolicySchema,
        );
      if (change.kind === 'revoke') return api.delete(`/me/connections/${change.id}`);
      const client = settings.data?.client;
      if (!client || !settings.data?.enabled || !boardIds.length)
        throw new Error('Consent unavailable');
      return api.post(
        '/me/connections',
        { clientId: client.id, boardIds, write: effectiveWrite },
        mcpConnectionSchema,
      );
    },
    onSuccess: async (_data, change) => {
      if (change.kind === 'grant') {
        setSelected([]);
        setWrite(false);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.connections() }),
        ...(change.kind === 'policy'
          ? [queryClient.invalidateQueries({ queryKey: keys.mcpBoardPolicy(change.boardId) })]
          : []),
      ]);
      setSaved(true);
    },
  });
  const retry = () => {
    void boards.refetch();
    void settings.refetch();
    policies.forEach((policy) => {
      void policy.refetch();
    });
  };
  const busy = mutation.isPending;
  // A board lookup failure must never hide the account's revoke controls.
  const loading = settings.isPending;
  const error = settings.isError;
  const existing = settings.data?.connections.some(
    (connection) => !connection.revokedAt && connection.clientId === settings.data?.client?.id,
  );

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
      {loading && <p role="status">{t('connections.loading')}</p>}
      {!loading && error && (
        <div role="alert" className="space-y-3">
          <p>{t('connections.loadError')}</p>
          <Button variant="outline" onClick={retry}>
            {t('connections.retry')}
          </Button>
        </div>
      )}
      {!loading && !error && settings.data && (
        <>
          {!settings.data.enabled && (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-3">
              {t('connections.disabled')}
            </p>
          )}
          <section aria-labelledby="connections-boards-title" className="space-y-4">
            <h2 id="connections-boards-title" className="text-base font-semibold">
              {t('connections.boardsTitle')}
            </h2>
            <p className="text-sm text-fg-3">{t('connections.boardsHint')}</p>
            {boards.isPending && <p role="status">{t('connections.loading')}</p>}
            {boards.isError && (
              <div role="alert">
                <p>{t('connections.boardLoadError')}</p>
                <Button variant="outline" onClick={() => void boards.refetch()}>
                  {t('connections.retry')}
                </Button>
              </div>
            )}
            {!boards.isPending && !boards.isError && !list.length && (
              <p className="text-sm text-fg-3">{t('connections.noBoards')}</p>
            )}
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {list.map((board, index) => {
                const allowed = policies[index]?.data?.enabled === true;
                const canSelect =
                  settings.data!.enabled &&
                  !boards.isError &&
                  eligible.some((item) => item.id === board.id);
                const policy = policies[index];
                const unavailable = policy?.isPending || policy?.isError;
                return (
                  <li
                    key={board.id}
                    className="flex flex-wrap items-center justify-between gap-4 p-4"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {settings.data!.enabled && (
                        <Checkbox
                          id={`select-${board.id}`}
                          aria-label={t('connections.selectBoard', { name: board.name })}
                          checked={boardIds.includes(board.id)}
                          disabled={
                            busy ||
                            !canSelect ||
                            (!boardIds.includes(board.id) && boardIds.length >= 50)
                          }
                          onCheckedChange={(checked) =>
                            setSelected((current) =>
                              checked
                                ? [...current.filter((id) => id !== board.id), board.id]
                                : current.filter((id) => id !== board.id),
                            )
                          }
                        />
                      )}
                      <div className="min-w-0">
                        <Label
                          htmlFor={settings.data!.enabled ? `select-${board.id}` : undefined}
                          className="break-words text-sm font-medium"
                        >
                          {board.name}
                        </Label>
                        <p className="text-xs text-fg-3">
                          {t(
                            policy?.isPending
                              ? 'connections.loading'
                              : policy?.isError
                                ? 'connections.boardLoadError'
                                : allowed
                                  ? 'connections.boardAllowed'
                                  : 'connections.boardBlocked',
                          )}
                        </p>
                      </div>
                    </div>
                    {policy?.isError && (
                      <Button variant="outline" size="sm" onClick={() => void policy.refetch()}>
                        {t('connections.retry')}
                      </Button>
                    )}
                    {board.currentUserRole === 'OWNER' ? (
                      <Switch
                        aria-label={t('connections.boardPolicy', { name: board.name })}
                        checked={allowed}
                        disabled={busy || unavailable || (!settings.data!.enabled && !allowed)}
                        onCheckedChange={(enabled) =>
                          mutation.mutate({ kind: 'policy', boardId: board.id, enabled })
                        }
                      />
                    ) : (
                      <span className="text-xs text-fg-3">{t('connections.ownerOnly')}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {settings.data.enabled && (
              <div className="space-y-4">
                {settings.data.writesEnabled && (
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="connection-write"
                      checked={effectiveWrite}
                      disabled={busy}
                      onCheckedChange={(checked) => setWrite(checked === true)}
                    />
                    <div>
                      <Label htmlFor="connection-write">{t('connections.allowChanges')}</Label>
                      <p className="text-xs text-fg-3">{t('connections.writeHint')}</p>
                    </div>
                  </div>
                )}
                <p className="text-sm text-fg-3">
                  {t('connections.consentHint', { client: settings.data.client?.name ?? '' })}
                </p>
                {existing && <p className="text-sm text-fg-3">{t('connections.existingHint')}</p>}
                <Button
                  disabled={
                    busy || boards.isError || !boardIds.length || existing || !settings.data.client
                  }
                  onClick={() => mutation.mutate({ kind: 'grant' })}
                >
                  {t('connections.approve')}
                </Button>
              </div>
            )}
          </section>
          {mutation.isError && (
            <p role="alert" className="text-sm text-status-danger">
              {t('connections.saveError')}
            </p>
          )}
          <p role="status" className="text-sm text-fg-3">
            {busy ? t('connections.saving') : saved ? t('connections.saved') : ''}
          </p>
          <section aria-labelledby="connections-active-title" className="space-y-4">
            <h2 id="connections-active-title" className="text-base font-semibold">
              {t('connections.activeTitle')}
            </h2>
            {!settings.data.connections.length && (
              <p className="text-sm text-fg-3">{t('connections.none')}</p>
            )}
            <ul className="space-y-3">
              {settings.data.connections.map((connection) => (
                <li
                  key={connection.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4"
                >
                  <div className="min-w-0 space-y-1">
                    <h3 className="font-medium">{connection.name}</h3>
                    <p className="text-xs text-fg-3">
                      {t(connection.revokedAt ? 'connections.revoked' : 'connections.active')} ·{' '}
                      {t(
                        connection.scopes.includes('wally:write')
                          ? 'connections.readWrite'
                          : 'connections.readOnly',
                      )}
                    </p>
                    <p className="break-words text-sm text-fg-3">
                      {connection.boardIds
                        .map(
                          (id) =>
                            list.find((board) => board.id === id)?.name ??
                            t('connections.unavailableBoard'),
                        )
                        .join(', ')}
                    </p>
                  </div>
                  {!connection.revokedAt && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      aria-label={t('connections.revokeNamed', { name: connection.name })}
                      onClick={() => mutation.mutate({ kind: 'revoke', id: connection.id })}
                    >
                      {t('connections.revoke')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {settings.data.enabled && (
            <section
              aria-labelledby="connections-setup-title"
              className="space-y-3 border-t border-border pt-6"
            >
              <h2 id="connections-setup-title" className="text-base font-semibold">
                {t('connections.setupTitle')}
              </h2>
              <p className="text-sm leading-relaxed text-fg-3">{t('connections.setupHint')}</p>
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
