import type { NotePriority } from '@wally/shared';
import { cn } from '@/lib/cn';

interface PriorityIconProps {
  priority: NotePriority;
  /** Rendered size in px. 14 on a note and in a list row, 12 inside a chip or segment. */
  size?: number;
  className?: string;
  /** Omit to render the icon as pure decoration beside a visible label. */
  label?: string;
}

/** How many of the three bars are filled at each level. */
const FILLED_BARS: Record<NotePriority, number> = { HOCH: 3, MITTEL: 2, NIEDRIG: 1 };

/* Three bars rising left to right, in a 16-unit box: x, y and height of each. */
const BARS = [
  { x: 1.5, y: 9, height: 5 },
  { x: 6.5, y: 5.5, height: 8.5 },
  { x: 11.5, y: 2, height: 12 },
] as const;

/**
 * Priority as a signal meter — three rising bars, the level read off how many are filled.
 * One colour (currentColor: ink on a note, white inside an "on" chip), so it survives every
 * note fill, and shape alone carries the level. Red for priority is banned outright: red
 * means late, and only late (docs/BRAND.md).
 */
export function PriorityIcon({ priority, size = 14, className, label }: PriorityIconProps) {
  const filled = FILLED_BARS[priority];
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={cn('shrink-0', className)}
    >
      {BARS.map((bar, index) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width={3}
          height={bar.height}
          rx={1}
          fill="currentColor"
          // Unfilled bars stay as a faint track, so every level shows the full scale.
          opacity={index < filled ? 1 : 0.22}
        />
      ))}
    </svg>
  );
}
