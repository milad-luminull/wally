import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { PendingDot } from '../Suggestions/PendingDot';
import type { TidyController } from './useTidy';

/**
 * The one quiet affordance at the edge of the zone bands (WALLYBOT_INLINE.md §3.5, plan R4):
 * a slim strip under the columns, always there on the horizon wall so nothing reflows, that
 * offers "Tidy N notes", then carries the batch's controls. The summary of what moves lives
 * on the cards; this is where the batch is kept or let go. A polite live region, so the
 * count and the outcome are announced; no toast (BRAND rule 5).
 */
export function TidyBar({ tidy }: { tidy: TidyController }) {
  const { t } = useTranslation();
  const { phase, count, moving } = tidy;
  return (
    <div
      role="toolbar"
      aria-label={t('tidy.barAria')}
      aria-live="polite"
      data-tidy-bar
      data-tidy-phase={phase}
      // On a coarse pointer the buttons grow to 40 px (button-variants); the strip grows with
      // them, so they never spill over the bands.
      className="flex h-7 shrink-0 items-center justify-end gap-2 px-4 text-12 text-fg-3 lg:px-5 [@media(pointer:coarse)]:h-10"
    >
      {phase === 'idle' && count > 0 && (
        <Button variant="ghost" size="sm" className="text-fg-3" onClick={tidy.tidy}>
          {t('tidy.action', { count })}
        </Button>
      )}
      {phase === 'asking' && (
        <span className="flex items-center gap-2">
          <PendingDot
            mark={{ phase: 'asking', countdownEndsAt: null, countdownMs: 0, paused: false }}
            onUndo={() => {}}
          />
          {t('tidy.asking')}
        </span>
      )}
      {phase === 'pending' && (
        <>
          <span>{t('tidy.pending', { count: moving })}</span>
          <Button variant="ghost" size="sm" onClick={() => tidy.keep('click')}>
            {t('tidy.keep')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-fg-3"
            onClick={() => tidy.discard('click')}
          >
            {t('tidy.discard')}
          </Button>
        </>
      )}
      {phase === 'kept' && (
        <>
          <span>{t('tidy.kept', { count: moving })}</span>
          <Button variant="ghost" size="sm" onClick={() => tidy.undo('click')}>
            {t('tidy.undo')}
          </Button>
        </>
      )}
      {phase === 'empty' && <span>{t('tidy.nothing')}</span>}
    </div>
  );
}
