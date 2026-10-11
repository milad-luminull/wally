import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CloudOff, LayoutGrid, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useBoards } from '@/features/board/hooks/useBoards';
import { useMe } from '@/i18n/useProfileLanguage';
import { AppSkeleton } from '@/components/AppSkeleton';

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
    return <AppSkeleton />;
  }

  if (isError) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background px-4">
        <EmptyState
          icon={<CloudOff strokeWidth={1.75} />}
          title={t('routes.root.loadFailed')}
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

  const lastBoardId = me.data?.preferences.lastBoardId;
  const lastBoard = boards?.find((b) => b.id === lastBoardId);
  const ownedBoard = boards?.find((b) => b.currentUserRole === 'OWNER');
  const target = lastBoard ?? ownedBoard ?? boards?.[0];

  if (!target) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background px-4">
        <EmptyState
          icon={<LayoutGrid strokeWidth={1.75} />}
          title={t('routes.root.noBoardTitle')}
          hint={t('routes.root.noBoardBody')}
        />
      </div>
    );
  }

  return <Navigate to={`/boards/${target.id}`} replace />;
}
