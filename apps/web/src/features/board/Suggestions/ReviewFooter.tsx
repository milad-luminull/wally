import { useEffect, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { CountdownRing } from './CountdownRing';
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

const action = cn(
  'inline-flex h-6 cursor-pointer items-center rounded-full px-2.5 text-12 font-medium',
  'transition-colors duration-150',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
  '[@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-4',
);

/**
 * The foot of a pending card or row (the smarter-capture spec §5, after Paper Wall v3): while
 * the call runs, "Filling in…"; once the proposal is there, the countdown ring with the seconds
 * left (or "Paused"), Undo and Keep. Undo discards the proposal and Keep keeps what is ticked,
 * exactly as Esc and Enter do; with nothing ticked Keep is disabled. The buttons are
 * `role="button"` spans, since on the wall the
 * card is itself a `<button>`, and every press stops here so it never opens the note.
 */
export function ReviewFooter({
  mark,
  onKeep,
  onUndo,
}: {
  mark: SuggestionMark;
  onKeep: () => void;
  onUndo: () => void;
}) {
  const { t } = useTranslation();
  const seconds = useSecondsLeft(mark.phase === 'pending' ? mark.countdownEndsAt : null);
  const shell = 'flex items-center gap-2 border-t border-[color:var(--note-border)] pt-2';
  if (mark.phase === 'asking')
    return (
      <span className={cn(shell, 'text-12 text-fg-meta-on-note')} role="status">
        {t('suggest.footer.asking')}
      </span>
    );
  if (mark.phase !== 'pending') return null;
  const empty = mark.fields.length === 0;
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
          action,
          'border border-[color:var(--note-border)] text-fg-1 hover:bg-inset-hover',
        )}
      >
        {t('suggest.undo')}
      </span>
      {/* With nothing ticked there is nothing to keep: Keep says so instead of discarding,
          so a Private left unticked never reads as kept. Undo stays the way out. */}
      <span
        role="button"
        tabIndex={0}
        aria-disabled={empty || undefined}
        onClick={empty ? undefined : onKeep}
        onKeyDown={onPress(empty ? () => {} : onKeep)}
        className={cn(
          action,
          'bg-primary text-primary-foreground',
          empty ? 'cursor-not-allowed opacity-40' : 'hover:opacity-90',
        )}
      >
        {t('suggest.footer.keep')}
      </span>
    </span>
  );
}
