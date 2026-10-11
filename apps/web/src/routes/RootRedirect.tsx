import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useBoards } from '@/features/board/hooks/useBoards';
import { useMe } from '@/i18n/useProfileLanguage';
import { Skeleton } from '@/components/ui/skeleton';

/** Resolves `/` to the board the caller last opened, if they can still reach it; else the
 * one they own, else their first active membership — then redirects to /boards/:id. The backend auto-provisions one board per
 * user on first auth (see the plan's auth hook), so an empty list here should only ever
 * happen transiently or in a genuine backend outage — handled with a plain error state,
 * not a crash. */
export function RootRedirect() {
  const { t } = useTranslation();
  const { data: boards, isLoading, isError, refetch } = useBoards();
  // Waited for so `/` doesn't flash the owned board before switching to the last one. A
  // failed profile load just means no remembered board.
  const me = useMe();

  if (isLoading || me.isLoading) {
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
          className="text-14 font-medium text-fg-1 underline-offset-4 hover:underline"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const lastBoardId = me.data?.preferences.lastBoardId;
  const lastBoard = boards?.find((b) => b.id === lastBoardId);
  const ownedBoard = boards?.find((b) => b.currentUserRole === 'OWNER');
  const target = lastBoard ?? ownedBoard ?? boards?.[0];

  if (!target) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-background px-4 text-center">
        <p className="text-14 font-medium text-fg-1">{t('routes.root.noBoardTitle')}</p>
        <p className="text-14 text-fg-muted">{t('routes.root.noBoardBody')}</p>
      </div>
    );
  }

  return <Navigate to={`/boards/${target.id}`} replace />;
}
