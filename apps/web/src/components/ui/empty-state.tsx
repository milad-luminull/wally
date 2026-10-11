import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The one empty state: an optional icon in a soft tile, a title, a hint, and an optional
 * action. Used for "this board is empty", "your filters hide everything" and an empty zone,
 * so all three read as the same voice at different sizes.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  size = 'md',
  className,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        size === 'md' ? 'gap-3 px-6 py-10' : 'gap-1.5 px-3 py-5',
        className,
      )}
    >
      {icon && size === 'md' && (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-fg-3 shadow-e1 [&_svg]:size-[18px]">
          {icon}
        </div>
      )}
      <div className="flex max-w-xs flex-col gap-1">
        <p className={cn('font-medium text-fg-1', size === 'md' ? 'text-14' : 'text-13')}>
          {title}
        </p>
        {hint && <p className={cn('text-fg-3', size === 'md' ? 'text-13' : 'text-12')}>{hint}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
