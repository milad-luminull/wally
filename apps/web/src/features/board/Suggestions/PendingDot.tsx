import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { RingCircle } from './CountdownRing';
import type { SuggestionMark } from './useSuggestions';

/** What the dot reads of a mark: a suggestion's, or a tidy's with no countdown. */
export type DotMark = Pick<SuggestionMark, 'phase' | 'countdownEndsAt' | 'countdownMs' | 'paused'>;

const SIZE = 14;
const STROKE = 2;
const R = (SIZE - STROKE) / 2;

/**
 * Marigold's fourth job (BRAND.md): the dot and its countdown ring on a note whose changes are
 * still pending, and nothing else. The ring is the one animation the spec names; under
 * reduced motion it advances in six steps instead of sweeping. Once kept, a faint Undo sits
 * where the dot was for a while (WALLYBOT_INLINE.md §3.3). No toast.
 */
export function PendingDot({
  mark,
  onUndo,
  label: labelOverride,
  ring = true,
  className,
}: {
  mark: DotMark;
  /** False where a review footer draws the ring instead: the dot then stays a plain marker. */
  ring?: boolean;
  /** The kept Undo's action; a dot that never shows the Undo needs none. */
  onUndo?: () => void;
  /** Replaces the dot's own name, for a mark that is not a suggestion's (a tidy's). */
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (mark.phase === 'kept')
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUndo?.();
        }}
        aria-label={t('suggest.undoAria')}
        className={cn(
          'rounded-[4px] px-1 text-12 text-fg-faint underline-offset-2 hover:text-fg-2 hover:underline',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
          '[@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:px-2',
          className,
        )}
      >
        {t('suggest.undo')}
      </button>
    );
  const asking = mark.phase === 'asking';
  const running = mark.countdownEndsAt !== null;
  const label =
    labelOverride ??
    (asking
      ? t('suggest.dotAriaAsking')
      : running || mark.paused
        ? t('suggest.dotAria')
        : t('suggest.dotAriaWaiting'));
  return (
    <svg
      role="img"
      aria-label={label}
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={cn('shrink-0', asking && 'opacity-50', className)}
    >
      <circle cx={SIZE / 2} cy={SIZE / 2} r={R - STROKE} className="fill-accent" />
      {ring && <RingCircle mark={mark} size={SIZE} stroke={STROKE} />}
    </svg>
  );
}
