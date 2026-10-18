import { cn } from '@/lib/cn';
import type { SuggestionMark } from './useSuggestions';

/** What a ring reads of a mark: whether its countdown runs, how long, and whether it is paused. */
export type RingMark = Pick<SuggestionMark, 'countdownEndsAt' | 'countdownMs' | 'paused'>;

/**
 * The countdown ring as an SVG circle, for the corner dot and the review footer alike
 * (marigold's fourth job, BRAND.md: the dot and its ring, nothing else). Drawn only while a
 * countdown runs or is paused. Under reduced motion it advances in six steps instead of
 * sweeping.
 */
export function RingCircle({
  mark,
  size,
  stroke,
}: {
  mark: RingMark;
  size: number;
  stroke: number;
}) {
  if (mark.countdownEndsAt === null && !mark.paused) return null;
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  return (
    <circle
      cx={size / 2}
      cy={size / 2}
      r={r}
      fill="none"
      strokeWidth={stroke}
      strokeDasharray={length}
      transform={`rotate(-90 ${size / 2} ${size / 2})`}
      style={{ '--ring-length': `${length}px`, '--ring-ms': `${mark.countdownMs}ms` } as never}
      className={cn(
        'stroke-accent animate-countdown motion-reduce:[animation-timing-function:steps(6,end)]',
        // globals.css cuts every animation to 0.001ms under reduced motion, which would
        // empty the ring at once; this one keeps its length and steps instead.
        'motion-reduce:![animation-duration:var(--ring-ms)]',
        mark.paused && '[animation-play-state:paused]',
      )}
    />
  );
}

/** The ring alone, on a hairline track, as the review footer shows it. */
export function CountdownRing({ mark, size = 16 }: { mark: RingMark; size?: number }) {
  const stroke = 2;
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={(size - stroke) / 2}
        fill="none"
        strokeWidth={stroke}
        className="stroke-[color:var(--note-border)]"
      />
      <RingCircle mark={mark} size={size} stroke={stroke} />
    </svg>
  );
}
