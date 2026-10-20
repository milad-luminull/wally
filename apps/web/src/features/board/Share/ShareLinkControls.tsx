import { useEffect, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { whiteboardRoleValues, type WhiteboardRole } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useEnumLabels } from '@/i18n/enumLabels';
import { useShareLink } from '../hooks/useShareLink';
import {
  useChangeShareLink,
  useCreateOrUpdateShareLink,
} from '../hooks/mutations/useShareLinkMutations';

export function ShareLinkControls({ boardId }: { boardId: string }) {
  const { t } = useTranslation();
  const { whiteboardRole } = useEnumLabels();
  const query = useShareLink(boardId, true);
  const save = useCreateOrUpdateShareLink(boardId);
  const change = useChangeShareLink(boardId);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const link = query.data;
  const busy = save.isPending || change.isPending || query.isFetching;
  useEffect(() => {
    setCopied(false);
    setCopyFailed(false);
  }, [link?.url]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <section
      className="-mx-4 -mb-4 flex flex-col gap-3 border-t border-border-subtle bg-surface-alt px-4 py-4"
      aria-label={t('share.linkSection')}
    >
      <h3 className="flex items-center gap-2 text-13 font-medium">
        <Link2 className="h-4 w-4 text-fg-3" aria-hidden />
        {t('share.linkSection')}
      </h3>
      {query.isLoading ? (
        <Skeleton className="h-9 w-full" />
      ) : query.isError && query.data === undefined ? (
        <div role="alert" className="text-13 text-fg-3">
          <p>{t('share.linkFailed')}</p>
          <Button
            variant="outline"
            className="mt-2"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : link ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-13 text-fg-2">{t('share.linkLabel')}</span>
            <Select
              value={link.role}
              disabled={busy}
              onValueChange={(role) => {
                change.reset();
                save.mutate(role as WhiteboardRole);
              }}
            >
              <SelectTrigger aria-label={t('share.linkRoleAria')} className="h-8 w-[120px] text-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {whiteboardRoleValues.map((role) => (
                  <SelectItem key={role} value={role}>
                    {whiteboardRole[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <input
            aria-label={t('share.linkUrlAria')}
            readOnly
            value={link.url}
            onFocus={(event) => event.currentTarget.select()}
            className="h-9 w-full min-w-0 rounded-md border border-border bg-surface px-2.5 font-mono text-12 text-fg-2"
          />
          <Button variant="outline" disabled={busy} onClick={() => void copy()}>
            {copied ? <Check strokeWidth={2} /> : <Copy strokeWidth={1.75} />}
            {copied ? t('share.copied') : t('share.copy')}
          </Button>
          <p className="text-12 text-fg-3">
            {t(link.role === 'EDIT' ? 'share.linkHint.EDIT' : 'share.linkHint.VIEW')}
          </p>
          {copyFailed && (
            <p role="alert" className="text-12 text-status-danger">
              {t('share.copyFailed')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                save.reset();
                change.reset();
                setConfirmRotate(true);
              }}
            >
              {t('share.regenerate')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                save.reset();
                change.mutate('disable');
              }}
            >
              {t('share.disable')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-12 text-fg-3">{t('share.linkDisabled')}</p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              change.reset();
              save.mutate('VIEW');
            }}
          >
            {t('share.enable')}
          </Button>
        </>
      )}
      {query.isError && query.data !== undefined && (
        <div role="alert" className="text-13 text-fg-3">
          {t('share.linkFailed')}
          <Button variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {!confirmRotate && (save.isError || change.isError) && (
        <p role="alert" className="text-12 text-status-danger">
          {t('share.linkSaveFailed')}
        </p>
      )}
      <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('share.regenerate')}</AlertDialogTitle>
          <AlertDialogDescription className="mt-2">
            {t('share.regenerateHint')}
          </AlertDialogDescription>
          {change.isError && (
            <p role="alert" className="mt-3 text-12 text-status-danger">
              {t('share.linkSaveFailed')}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={change.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <Button
              disabled={change.isPending}
              onClick={() => change.mutate('rotate', { onSuccess: () => setConfirmRotate(false) })}
            >
              {t('share.replace')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
