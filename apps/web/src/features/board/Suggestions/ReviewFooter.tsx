import { useEffect, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';
import { formatWhen } from '@/lib/formatWhen';
import { CountdownRing } from './CountdownRing';
import { footerAction } from './footerAction';
import type { SuggestionMark } from './useSuggestions';

const stop = (e: SyntheticEvent) => e.stopPropagation();
/** Enter and Space press a `role="button"` span, and go no further than it. */
const onPress = (action: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  e.stopPropagation();
  action();
};

/** Whole seconds left on a running countdown, updated each second; null when none runs. */
function useSecondsLeft(endsAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endsAt]);
  return endsAt === null ? null : Math.max(1, Math.ceil((endsAt - now) / 1000));
}

/**
 * The foot of a pending card or row (the smarter-capture spec §5, after Paper Wall v3): while
 * the call runs, "Filling in…"; once the proposal is there, the countdown ring with the seconds
 * left (or "Paused"), Undo and Keep. Undo discards the proposal and Keep keeps what is ticked,
 * exactly as Esc and Enter do; with everything crossed out Keep discards. It sits under the card
 * or row, never inside its button; every press stops here so it never opens the note.
 */
export function ReviewFooter({
  mark,
  onKeep,
  onUndo,
  onRetry,
  onDismiss,
}: {
  mark: SuggestionMark;
  onKeep: () => void;
  onUndo: () => void;
  /** An outcome line's Try again. */
  onRetry?: () => void;
  /** An outcome line's ×. */
  onDismiss?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const seconds = useSecondsLeft(mark.phase === 'pending' ? mark.countdownEndsAt : null);
  const shell = 'flex items-center gap-2 pt-1';
  if (mark.phase === 'asking')
    return (
      <span role="status" className="flex items-center gap-2 text-12 font-medium">
        <span className="capture-shimmer">{t('suggest.footer.asking')}</span>
        <span aria-hidden className="inline-flex gap-[3px]">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="capture-dot h-1 w-1 rounded-full bg-accent"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      </span>
    );
  if (mark.phase === 'outcome' && mark.outcome) {
    // What the AI could not do, said on its own card (the error handling spec, BRAND rule 5):
    // never a toast, never focus taken.
    const { outcome } = mark;
    const daily = outcome.code === 'ASSISTANT_DAILY_CAP';
    const when = outcome.resetsAt ? formatWhen(outcome.resetsAt, i18n.language, daily) : null;
    const line =
      outcome.kind === 'nothing'
        ? t('suggest.outcome.nothing')
        : outcome.kind === 'busy'
          ? t('suggest.outcome.busy')
          : outcome.kind === 'saveFailed'
            ? t('suggest.outcome.saveFailed')
            : outcome.kind === 'changed'
              ? t('suggest.outcome.changed')
              : !when
                ? t('suggest.outcome.limit')
                : t(daily ? 'suggest.outcome.limitDaily' : 'suggest.outcome.limitMonthly', {
                    when,
                  });
    const fades = outcome.kind === 'nothing' || outcome.kind === 'changed';
    return (
      <span
        data-review-footer
        data-outcome={outcome.kind}
        className={cn(shell, fades && 'capture-outcome-fade')}
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={stop}
      >
        <span role="status" className="min-w-0 flex-1 text-12 text-fg-meta-on-note">
          {line}
        </span>
        {outcome.canRetry && onRetry && (
          <span
            role="button"
            tabIndex={0}
            onClick={onRetry}
            onKeyDown={onPress(onRetry)}
            className={cn(footerAction, 'bg-primary text-primary-foreground hover:opacity-90')}
          >
            {t('suggest.outcome.tryAgain')}
          </span>
        )}
        {!fades && onDismiss && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t('suggest.outcome.dismiss')}
            onClick={onDismiss}
            onKeyDown={onPress(onDismiss)}
            className={cn(
              footerAction,
              'w-6 justify-center px-0 text-fg-faint hover:bg-inset-hover hover:text-fg-1',
            )}
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          </span>
        )}
      </span>
    );
  }
  if (mark.phase !== 'pending') return null;
  const status =
    seconds !== null
      ? t('suggest.footer.saving', { count: seconds })
      : mark.paused
        ? t('suggest.footer.paused')
        : '';
  return (
    <span
      data-review-footer
      className={shell}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
    >
      {status && <CountdownRing mark={mark} />}
      <span className="min-w-0 flex-1 truncate text-12 tabular-nums text-fg-meta-on-note">
        {status}
      </span>
      <span
        role="button"
        tabIndex={0}
        onClick={onUndo}
        onKeyDown={onPress(onUndo)}
        className={cn(
          footerAction,
          'border border-[color:var(--note-border)] text-fg-1 hover:bg-inset-hover',
        )}
      >
        {t('suggest.undo')}
      </span>
      <span
        role="button"
        tabIndex={0}
        data-review-keep
        onClick={onKeep}
        onKeyDown={onPress(onKeep)}
        className={cn(footerAction, 'bg-primary text-primary-foreground hover:opacity-90')}
      >
        {t('suggest.footer.keep')}
      </span>
    </span>
  );
}
