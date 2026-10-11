import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

/**
 * The board's columns while notes load. Mirrors the real zone and card geometry rather than
 * showing generic blocks, so the board does not visibly re-flow the moment notes arrive.
 */
export function BoardSkeleton({
  columns = 3,
  label = true,
}: {
  columns?: number;
  label?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="board-surface flex min-w-0 flex-1 gap-3 overflow-hidden p-4 [justify-content:safe_center] lg:p-5"
      {...(label ? { role: 'status', 'aria-label': t('common.loading') } : { 'aria-hidden': true })}
    >
      {Array.from({ length: columns }).map((_, column) => (
        <div
          key={column}
          className="flex h-full w-[276px] shrink-0 flex-col rounded-xl border border-border-subtle bg-[color:var(--zone-surface)]"
        >
          <div className="flex h-11 items-center gap-2 px-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-4" />
          </div>
          <div className="flex flex-col gap-2 px-2.5 pb-2.5">
            {Array.from({ length: 3 - column }).map((__, card) => (
              <Skeleton key={card} className="h-[76px] w-full rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The whole app shell, empty: top bar, filter row and board. One skeleton for every stage
 * of getting to a board — auth resolving, `/` picking a board, the board loading — so the
 * hand-offs between them don't flash three different layouts in a row.
 */
export function AppSkeleton({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <div
      className={cn('flex h-[100dvh] flex-col bg-background', className)}
      role="status"
      aria-label={t('common.loading')}
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <Skeleton className="h-5 w-5 rounded-md" />
        <Skeleton className="h-3.5 w-32" />
        <div className="flex-1" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-7 rounded-full" />
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-4">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-16" />
      </div>
      <BoardSkeleton label={false} />
    </div>
  );
}
