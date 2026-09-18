import { useParams } from 'react-router';
import { useBoard } from '@/features/board/hooks/useBoard';
import { AppShell } from '@/features/board/AppShell';
import { Skeleton } from '@/components/ui/skeleton';
import { NotFoundPage } from './NotFoundPage';

export function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const { data: board, isLoading, isError, error } = useBoard(boardId);

  if (isLoading) {
    return (
      <div className="flex h-screen flex-col gap-4 bg-background p-6">
        <Skeleton className="h-8 w-64" />
        <div className="flex flex-1 gap-4">
          <Skeleton className="h-full flex-1" />
          <Skeleton className="h-full flex-1" />
          <Skeleton className="h-full flex-1" />
        </div>
      </div>
    );
  }

  // A board that doesn't exist or that the caller isn't a member of is a 404 — the API
  // deliberately hides existence from non-members (see the plan's auth notes), so we
  // don't try to distinguish "not found" from "not yours" in the UI either.
  const status = (error as { status?: number } | undefined)?.status;
  if (isError && (status === 404 || status === 403)) return <NotFoundPage />;

  if (isError || !board) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-background px-4 text-center">
        <p className="text-14 font-medium text-fg-1">Die Wand konnte nicht geladen werden.</p>
      </div>
    );
  }

  return <AppShell board={board} boardId={board.id} />;
}
