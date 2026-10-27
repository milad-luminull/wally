import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CloudOff, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useBoards } from '@/features/board/hooks/useBoards';
import { readReturnPath } from '@/features/auth/returnPath';
import { AppSkeleton } from '@/components/AppSkeleton';

/**
 * `/app` resolves the destination after authentication. It waits for the caller's board
 * list, then follows the return path if it is a share link or a board on that list, else by
 * count — straight into the only board, or to the board home with none or several
 * (RFC-0002 §5, §6).
 *
 * Checking the return path against the list is what keeps a board from the previous account
 * from becoming a 404 straight after signing in.
 */
export function BoardEntryPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const { data: boards, isLoading, isError, refetch } = useBoards();

  if (isLoading) return <AppSkeleton />;

  if (isError || !boards) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background px-4">
        <EmptyState
          icon={<CloudOff strokeWidth={1.75} />}
          title={t('routes.home.loadFailed')}
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              <RotateCcw strokeWidth={1.75} />
              {t('common.retry')}
            </Button>
          }
        />
      </div>
    );
  }

  const to = readReturnPath({ from: (location.state as { to?: unknown } | null)?.to });
  if (to?.startsWith('/share/')) return <Navigate to={to} replace />;
  const boardId = to?.match(/^\/boards\/([^/?#]+)/)?.[1];
  if (to && boards.some((board) => board.id === boardId)) return <Navigate to={to} replace />;

  if (boards.length === 1) return <Navigate to={`/boards/${boards[0]!.id}`} replace />;
  return <Navigate to="/boards" replace />;
}
