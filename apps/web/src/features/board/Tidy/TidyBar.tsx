import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { PendingDot } from '../Suggestions/PendingDot';
import type { TidyController } from './useTidy';

/**
 * The one quiet affordance at the edge of the zone bands (WALLYBOT_INLINE.md §3.5, plan R4):
 * a slim strip under the columns, always there on the horizon wall so nothing reflows, that
 * offers "Tidy N notes", then carries the batch's controls. The summary of what moves lives
 * on the cards; this is where the batch is kept or let go. The strip is a toolbar only while
 * it holds a control; what happened is said in a polite status of its own, always present,
 * so the count and the outcome are announced and the buttons' names are not. No toast
 * (BRAND rule 5).
 */
export function TidyBar({ tidy }: { tidy: TidyController }) {
  const { t } = useTranslation();
  const { phase, count, moving } = tidy;
  const offer = phase === 'idle' && count > 0;
  const controls = offer || phase === 'pending' || phase === 'kept';
  const said =
    phase === 'asking'
      ? t('tidy.asking')
      : phase === 'pending'
        ? t('tidy.pending', { count: moving })
        : phase === 'kept'
          ? t('tidy.kept', { count: moving })
          : phase === 'empty'
            ? t('tidy.nothing')
            : '';
  return (
    <div
      role={controls ? 'toolbar' : undefined}
      aria-label={controls ? t('tidy.barAria') : undefined}
      data-tidy-bar
      data-tidy-phase={phase}
      // On a coarse pointer the buttons grow to 40 px (button-variants); the strip grows with
      // them, so they never spill over the bands.
      className="flex h-7 shrink-0 items-center justify-end gap-2 px-4 text-12 text-fg-3 lg:px-5 [@media(pointer:coarse)]:h-10"
    >
      {phase === 'asking' && (
        <PendingDot
          mark={{ phase: 'asking', countdownEndsAt: null, countdownMs: 0, paused: false }}
        />
      )}
      <span role="status" aria-live="polite">
        {said}
      </span>
      {offer && (
        <Button variant="ghost" size="sm" className="text-fg-3" onClick={tidy.tidy}>
          {t('tidy.action', { count })}
        </Button>
      )}
      {phase === 'pending' && (
        <>
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
        <Button variant="ghost" size="sm" onClick={() => tidy.undo('click')}>
          {t('tidy.undo')}
        </Button>
      )}
    </div>
  );
}
