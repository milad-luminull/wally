import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CloudOff, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useBoard } from '@/features/board/hooks/useBoard';
import { useMe } from '@/i18n/useProfileLanguage';
import { AppShell } from '@/features/board/AppShell';
import { AppSkeleton } from '@/components/AppSkeleton';
import { NotFoundPage } from './NotFoundPage';

export function BoardPage() {
  const { t } = useTranslation();
  const { boardId } = useParams<{ boardId: string }>();
  const { data: board, isLoading, isError, error, refetch } = useBoard(boardId);
  // The saved view settings live on the profile; rendering before it lands would flash the
  // defaults and then jump to the user's view.
  const me = useMe();

  if (isLoading || me.isLoading) {
    return <AppSkeleton />;
  }

  // A board that doesn't exist or that the caller isn't a member of is a 404 — the API
  // deliberately hides existence from non-members (see the plan's auth notes), so we
  // don't try to distinguish "not found" from "not yours" in the UI either.
  const status = (error as { status?: number } | undefined)?.status;
  if (isError && (status === 404 || status === 403)) return <NotFoundPage />;

  if (isError || !board) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-background px-4">
        <EmptyState
          icon={<CloudOff strokeWidth={1.75} />}
          title={t('routes.board.loadFailed')}
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

  return <AppShell board={board} boardId={board.id} />;
}
