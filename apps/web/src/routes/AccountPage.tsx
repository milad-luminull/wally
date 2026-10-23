import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from '@/lib/apiClient';
import { useAuth } from '@/features/auth/AuthProvider';
import { HomeShell } from '@/features/boards/HomeShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';

const previewSchema = z.object({
  ownedBoards: z.array(z.object({ id: z.string(), name: z.string() })),
  recentAuthentication: z.boolean(),
});
const pendingSchema = z.object({ status: z.literal('pending') });
export function AccountSettings() {
  const { t } = useTranslation();
  const { user, signOut, reauthenticate } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [reauthError, setReauthError] = useState(false);
  const preview = useQuery({
    queryKey: [user?.uid, 'account-deletion-preview'],
    queryFn: () => api.get('/me/deletion', previewSchema),
    enabled: deleteOpen,
  });
  const download = useMutation({
    mutationFn: async () => {
      const data = await api.get('/me/export', z.record(z.unknown()));
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'wally-account.json';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const deletion = useMutation({
    mutationFn: () => api.deleteWithBody('/me', { confirmation }, pendingSchema),
    onError: () => void preview.refetch(),
  });
  if (deletion.isSuccess)
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-12">
        <h1 className="text-2xl font-semibold">{t('accountData.requested')}</h1>
        <p role="status">{t('accountData.pending')}</p>
        <Button onClick={() => void signOut()}>{t('account.signOut')}</Button>
      </div>
    );
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
      <div className="space-y-3">
        <Link to="/boards" className="text-sm underline underline-offset-4">
          {t('connections.back')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('accountData.title')}</h1>
        <Link to="/privacy" className="text-sm underline underline-offset-4">
          {t('privacy.title')}
        </Link>
      </div>
      <section className="space-y-3" aria-labelledby="export-title">
        <h2 id="export-title" className="text-lg font-semibold">
          {t('accountData.exportTitle')}
        </h2>
        <p className="text-sm text-fg-3">{t('accountData.exportHint')}</p>
        <Button variant="outline" disabled={download.isPending} onClick={() => download.mutate()}>
          {t(download.isPending ? 'accountData.downloading' : 'accountData.download')}
        </Button>
        {download.isError && <p role="alert">{t('accountData.exportError')}</p>}
      </section>
      <section className="space-y-4 border-t border-border pt-6" aria-labelledby="delete-title">
        <h2 id="delete-title" className="text-lg font-semibold">
          {t('accountData.deleteTitle')}
        </h2>
        <p className="text-sm text-fg-3">{t('accountData.deleteHint')}</p>
        <Dialog
          open={deleteOpen}
          onOpenChange={(open) => {
            if (deletion.isPending) return;
            setDeleteOpen(open);
            setConfirmation('');
            setReauthError(false);
            deletion.reset();
          }}
        >
          <DialogTrigger asChild>
            <Button variant="destructive">{t('accountData.deleteTitle')}</Button>
          </DialogTrigger>
          <DialogContent
            className="max-h-[85dvh] overflow-y-auto space-y-4"
            hideClose={deletion.isPending}
          >
            <DialogHeader>
              <DialogTitle>{t('accountData.deleteTitle')}</DialogTitle>
              <p className="break-all text-sm font-medium">
                {t('accountData.account', { email: user?.email ?? '' })}
              </p>
              <DialogDescription>{t('accountData.warning')}</DialogDescription>
            </DialogHeader>
            <Button
              variant="outline"
              disabled={download.isPending || deletion.isPending}
              onClick={() => download.mutate()}
            >
              {t(download.isPending ? 'accountData.downloading' : 'accountData.download')}
            </Button>
            {download.isError && <p role="alert">{t('accountData.exportError')}</p>}
            {preview.isPending && <p role="status">{t('accountData.loading')}</p>}
            {preview.isError && (
              <div role="alert">
                <p>{t('accountData.loadError')}</p>
                <Button variant="outline" onClick={() => void preview.refetch()}>
                  {t('common.retry')}
                </Button>
              </div>
            )}
            {preview.data && (
              <>
                <p className="font-medium">
                  {t('accountData.ownedBoards', { count: preview.data.ownedBoards.length })}
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {preview.data.ownedBoards.map((board) => (
                    <li key={board.id}>{board.name}</li>
                  ))}
                </ul>
                {!preview.data.recentAuthentication && (
                  <div className="space-y-3">
                    <p className="text-sm text-fg-3">{t('accountData.reauthHint')}</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setReauthError(false);
                        void (
                          reauthenticate ? reauthenticate('/settings/account') : signOut()
                        ).catch(() => setReauthError(true));
                      }}
                    >
                      {t('accountData.reauth')}
                    </Button>
                    {reauthError && <p role="alert">{t('accountData.reauthError')}</p>}
                  </div>
                )}
                {preview.data.recentAuthentication && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="account-delete-confirmation">
                        {t('accountData.confirmation')}
                      </Label>
                      <Input
                        id="account-delete-confirmation"
                        autoComplete="off"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                        disabled={deletion.isPending}
                      />
                    </div>
                    <Button
                      variant="destructive"
                      disabled={
                        confirmation !== 'DELETE' ||
                        !preview.data.recentAuthentication ||
                        deletion.isPending ||
                        preview.isFetching ||
                        preview.isError ||
                        download.isPending
                      }
                      onClick={() => deletion.mutate()}
                    >
                      {t(deletion.isPending ? 'accountData.deleting' : 'accountData.delete')}
                    </Button>
                  </>
                )}
              </>
            )}
            {deletion.isError && <p role="alert">{t('accountData.deleteError')}</p>}
            <DialogClose asChild>
              <Button variant="outline" disabled={deletion.isPending}>
                {t('common.cancel')}
              </Button>
            </DialogClose>
          </DialogContent>
        </Dialog>
      </section>
    </div>
  );
}
export function AccountPage() {
  return (
    <HomeShell>
      <AccountSettings />
    </HomeShell>
  );
}
