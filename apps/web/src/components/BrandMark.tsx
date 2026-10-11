interface BrandMarkProps {
  /** Rendered size in px. The guideline's floor is 16; below that use the wordmark alone. */
  size?: number;
  /**
   * `onLight` is the primary pair — a slate note with a blue pin. On a slate field the pair
   * inverts. On blue the note stays slate and the pin stays blue, so the pin reads as a hole.
   */
  tone?: 'onLight' | 'onSlate';
  className?: string;
  title?: string;
}

/**
 * The Wally mark, built to the guideline's proportions rather than drawn once at one size:
 * a square note with a corner radius 22% of its side, and one round pin at top centre whose
 * diameter is 21% of the side, its centre 28% down from the top edge. Nothing else — no
 * letter in it, no tilt, no shadow, no gradient.
 *
 * Because every measurement is a ratio of the side, a single 24-unit viewBox scales cleanly
 * from a 16px favicon to a wall. Keep public/favicon.svg in step with these numbers.
 */
export function BrandMark({ size = 24, tone = 'onLight', className, title }: BrandMarkProps) {
  const note = tone === 'onSlate' ? 'var(--linen)' : 'var(--slate)';
  const pin = 'var(--blue)';
  const S = 24;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${S} ${S}`}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect width={S} height={S} rx={S * 0.22} fill={note} />
      <circle cx={S / 2} cy={S * 0.28} r={S * 0.105} fill={pin} />
    </svg>
  );
}
