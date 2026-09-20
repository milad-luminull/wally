import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useBoards } from '@/features/board/hooks/useBoards';
import { Skeleton } from '@/components/ui/skeleton';

/** Resolves `/` to the caller's default board: the one they own, else their first active
 * membership — then redirects to /boards/:id. The backend auto-provisions one board per
 * user on first auth (see the plan's auth hook), so an empty list here should only ever
 * happen transiently or in a genuine backend outage — handled with a plain error state,
 * not a crash. */
export function RootRedirect() {
  const { t } = useTranslation();
  const { data: boards, isLoading, isError, refetch } = useBoards();

  if (isLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <p className="text-14 font-medium text-fg-1">{t('routes.root.loadFailed')}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-13 font-medium text-fg-1 underline-offset-4 hover:underline"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const ownedBoard = boards?.find((b) => b.currentUserRole === 'OWNER');
  const target = ownedBoard ?? boards?.[0];

  if (!target) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-background px-4 text-center">
        <p className="text-14 font-medium text-fg-1">{t('routes.root.noBoardTitle')}</p>
        <p className="text-13 text-fg-muted">{t('routes.root.noBoardBody')}</p>
      </div>
    );
  }

  return <Navigate to={`/boards/${target.id}`} replace />;
}
