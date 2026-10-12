import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  discardRecovery,
  getRecoveries,
  retryMutation,
  subscribeRecoveries,
  type Recovery,
} from '@/lib/mutationQueue';
import { clearNoteDraft } from '@/lib/noteDrafts';
import type { MessageKey } from '@/i18n/keys';

function ChangeValues({ value, field }: { value: unknown; field?: string }) {
  const { t } = useTranslation();
  if (value === null || value === undefined) return <span>{t('safety.none')}</span>;
  if (typeof value === 'boolean') return <span>{t(value ? 'safety.yes' : 'safety.no')}</span>;
  if (Array.isArray(value))
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <ChangeValues key={index} value={item} field={field} />
        ))}
      </div>
    );
  if (typeof value === 'object') {
    const hidden = new Set([
      'id',
      'whiteboardId',
      'noteId',
      'revision',
      'ownerId',
      'token',
      'url',
      'createdAt',
      'updatedAt',
      'createdBy',
      'history',
      'currentUserRole',
      'mode',
      'boardRevision',
      'createdById',
    ]);
    const fields = Object.entries(value).filter(([key]) => !hidden.has(key));
    return (
      <dl className="space-y-2">
        {fields.map(([key, entry]) => (
          <div key={key}>
            <dt className="text-12 text-fg-3">
              {t(`safety.fields.${key}` as MessageKey, { defaultValue: key })}
            </dt>
            <dd className="whitespace-pre-wrap break-words text-13 text-fg-1">
              <ChangeValues value={entry} field={key} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  const category = field === 'role' ? 'effectiveRole' : field;
  const label =
    category && ['effectiveRole', 'colour', 'horizon', 'priority'].includes(category)
      ? t(`enums.${category}.${value}` as MessageKey, { defaultValue: String(value) })
      : field === 'status'
        ? t(`safety.status.${value}` as MessageKey, { defaultValue: String(value) })
        : String(value);
  return <span className="whitespace-pre-wrap break-words">{label || t('safety.empty')}</span>;
}

function ReviewChange({ recovery, onClose }: { recovery: Recovery; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [latest, setLatest] = useState<{ data: unknown; revision: number; proposed?: unknown }>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const expired = !recovery.conflict && Date.now() - recovery.ticket.createdAt >= 7 * 86400000;
  useEffect(() => {
    let active = true;
    if (recovery.description)
      void recovery.description
        .loadLatest()
        .then((value) => {
          if (active) setLatest(value);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    return () => {
      active = false;
    };
  }, [recovery]);
  async function apply() {
    setBusy(true);
    try {
      await retryMutation(
        recovery.ticket.operationId,
        recovery.conflict ? latest?.revision : undefined,
      );
    } catch {
      /* The queue preserves the failed or newly stale action for another review. */
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries();
      onClose();
    }
  }
  function discard() {
    if (recovery.ticket.resource.startsWith('note:')) {
      const id = recovery.ticket.resource.slice(5);
      const input = recovery.description?.input as Record<string, unknown> | undefined;
      for (const field of ['title', 'description'])
        if (typeof input?.[field] === 'string') clearNoteDraft(`${id}:${field}`, input[field]);
    }
    discardRecovery(recovery.ticket.operationId);
    void queryClient.invalidateQueries();
    onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('safety.title')}</DialogTitle>
          <DialogDescription>
            {t(recovery.conflict ? 'safety.conflict' : 'safety.failed')}
          </DialogDescription>
        </DialogHeader>
        <p className="text-14 font-medium">
          {t(`safety.actions.${recovery.description?.action ?? 'update'}` as MessageKey)}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-lg border border-border p-3">
            <h3 className="mb-3 text-13 font-medium">{t('safety.latest')}</h3>
            {latest ? (
              <ChangeValues value={latest.data} />
            ) : (
              <p role="status" className="text-13 text-fg-3">
                {t(failed ? 'safety.unavailable' : 'common.loading')}
              </p>
            )}
          </section>
          <section className="rounded-lg border border-border p-3">
            <h3 className="mb-3 text-13 font-medium">{t('safety.proposed')}</h3>
            <ChangeValues value={latest?.proposed ?? recovery.description?.input} />
          </section>
        </div>
        {expired && (
          <p role="alert" className="text-13 text-fg-2">
            {t('safety.expired')}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t('safety.keep')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={discard}>
            {t('safety.discard')}
          </Button>
          <Button
            disabled={busy || expired || (recovery.conflict && !latest)}
            onClick={() => void apply()}
          >
            {t(recovery.conflict ? 'safety.apply' : 'common.retry')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pending changes stay reachable after a toast or note panel has closed. */
export function MutationRecovery() {
  const { t } = useTranslation();
  const recoveries = useSyncExternalStore(subscribeRecoveries, getRecoveries);
  const [selected, setSelected] = useState<string>();
  if (recoveries.length === 0) return null;
  const recovery = recoveries.find((item) => item.ticket.operationId === selected);
  return (
    <>
      <Button
        variant="outline"
        className="fixed bottom-5 left-1/2 z-toast max-w-[90vw] -translate-x-1/2 bg-surface shadow-e3"
        onClick={() => setSelected(recoveries[0]!.ticket.operationId)}
      >
        {t('safety.pending', { count: recoveries.length })}
      </Button>
      {recovery && (
        <ReviewChange
          key={recovery.ticket.operationId}
          recovery={recovery}
          onClose={() => setSelected(undefined)}
        />
      )}
    </>
  );
}
