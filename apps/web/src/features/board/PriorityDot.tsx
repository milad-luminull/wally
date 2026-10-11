import type { NotePriority } from '@wally/shared';
import { cn } from '@/lib/cn';
import { priorityDotClass } from './util/noteDerived';

interface PriorityDotProps {
  priority: NotePriority;
  /** Size in px. 7 on a note, 6 in a filter chip, 8 in the panel header. */
  size?: 6 | 7 | 8;
  className?: string;
  /** Omit to render the dot as pure decoration beside a visible label. */
  label?: string;
}

/**
 * Priority as shape on one colour — high is a filled ink dot, medium the same dot hollow,
 * low nothing at all. Centralised because the "low has no mark" case is easy to get wrong:
 * every caller has to cope with rendering nothing, and a faint third dot would quietly
 * reintroduce the hue ladder the guideline removed (docs/BRAND.md, "Priority is a single
 * single dot").
 */
export function PriorityDot({ priority, size = 7, className, label }: PriorityDotProps) {
  const shape = priorityDotClass[priority];
  if (!shape) return null;
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      style={{ height: size, width: size }}
      className={cn('shrink-0 rounded-full', shape, className)}
    />
  );
}
