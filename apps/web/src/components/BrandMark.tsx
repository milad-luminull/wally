import { useId } from 'react';

interface BrandMarkProps {
  /** Rendered size in px. Below 16 use the wordmark alone. */
  size?: number;
  className?: string;
  title?: string;
}

/**
 * The Wally mark: a marigold face with two ink eyes and a soft highlight at the upper left.
 * Its colours are fixed hex, not theme tokens, so the mark looks the same on every palette
 * and in dark mode.
 *
 * Every measurement is in one 100-unit viewBox, so it scales cleanly from a 16px favicon up.
 * Keep public/favicon.svg in step with these numbers.
 */
export function BrandMark({ size = 24, className, title }: BrandMarkProps) {
  // Several marks can share a page, so each needs its own gradient id; useId's colons are
  // stripped because they don't survive inside url(#…).
  const gradientId = `wally-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <radialGradient id={gradientId} cx="25%" cy="15%" r="120%">
          <stop offset="0" stopColor="#FFD36B" />
          <stop offset="0.48" stopColor="#F5A524" />
          <stop offset="1" stopColor="#EE7A2F" />
        </radialGradient>
      </defs>
      <rect x="4" y="4" width="92" height="92" rx="29" fill={`url(#${gradientId})`} />
      <ellipse
        cx="29"
        cy="20"
        rx="15"
        ry="7"
        fill="#fff"
        fillOpacity="0.45"
        transform="rotate(-18 29 20)"
      />
      <rect x="31" y="35" width="11" height="19" rx="6" fill="#111" />
      <rect x="58" y="35" width="11" height="19" rx="6" fill="#111" />
    </svg>
  );
}
