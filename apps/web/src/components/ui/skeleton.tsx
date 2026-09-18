import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Loading placeholder. Reduced-motion-safe: opacity pulse only, no translate/scale. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-inset', className)} {...props} />;
}
