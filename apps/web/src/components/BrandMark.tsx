interface BrandMarkProps {
  /** Rendered size in px. Below 16 use the wordmark alone. */
  size?: number;
  className?: string;
  title?: string;
}

/**
 * The Wally mark: two notes on a wall. A marigold note sits behind and to the upper right;
 * an ink note overlaps it from the lower left, cut out from it by a gap the colour of
 * whatever is behind the mark. Ink is `--fg-1`, so the front note flips with the theme while
 * marigold stays put.
 *
 * Every measurement is in one 24-unit viewBox, so it scales cleanly from a 16px favicon up.
 * Keep public/favicon.svg in step with these numbers.
 */
export function BrandMark({ size = 24, className, title }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <mask id="wally-mark-gap">
          <rect width="24" height="24" fill="white" />
          <rect x="0.5" y="6.5" width="17" height="17" rx="5" fill="black" />
        </mask>
      </defs>
      <rect
        x="7"
        y="0"
        width="17"
        height="17"
        rx="4.5"
        fill="var(--accent)"
        mask="url(#wally-mark-gap)"
      />
      <rect x="2" y="8" width="14" height="14" rx="3.5" fill="var(--fg-1)" />
    </svg>
  );
}
