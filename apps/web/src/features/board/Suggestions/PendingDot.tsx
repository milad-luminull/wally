import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { SuggestionMark } from './useSuggestions';

/** What the dot reads of a mark: a suggestion's, or a tidy's with no countdown. */
export type DotMark = Pick<SuggestionMark, 'phase' | 'countdownEndsAt' | 'countdownMs' | 'paused'>;

const SIZE = 14;
const STROKE = 2;
const R = (SIZE - STROKE) / 2;
const LENGTH = 2 * Math.PI * R;

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
  className,
}: {
  mark: DotMark;
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
      {(running || mark.paused) && (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeDasharray={LENGTH}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ '--ring-length': `${LENGTH}px`, '--ring-ms': `${mark.countdownMs}ms` } as never}
          className={cn(
            'stroke-accent animate-countdown motion-reduce:[animation-timing-function:steps(6,end)]',
            // globals.css cuts every animation to 0.001ms under reduced motion, which would
            // empty the ring at once; this one keeps its length and steps instead.
            'motion-reduce:![animation-duration:var(--ring-ms)]',
            mark.paused && '[animation-play-state:paused]',
          )}
        />
      )}
    </svg>
  );
}
