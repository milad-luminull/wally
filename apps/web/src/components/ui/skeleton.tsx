import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Loading placeholder. Reduced-motion-safe: the sweep is an opacity/background shift with
 * no translate or scale, and the global reduced-motion rule stops it looping. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('wally-skeleton animate-shimmer rounded-md', className)} {...props} />;
}
