import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CloudOff, LayoutGrid, Plus, RotateCcw } from 'lucide-react';
import type { WhiteboardSummaryDto } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoards } from '@/features/board/hooks/useBoards';
import { useEnumLabels } from '@/i18n/enumLabels';
import { useMe } from '@/i18n/useProfileLanguage';
import { BoardRow } from './BoardRow';
import { DeleteBoardDialog } from './DeleteBoardDialog';
import { LeaveBoardDialog } from './LeaveBoardDialog';
import { NewBoardDialog } from './NewBoardDialog';

type Dialog =
  | { kind: 'create'; open: boolean }
  | {
      kind: 'delete' | 'leave';
      board: WhiteboardSummaryDto;
      open: boolean;
      /** The row's menu button, for focus to return to when the confirmation is cancelled. */
      opener: HTMLElement | null;
    };

/**
 * Every board the caller can open, in one place (RFC BOARD_HOME §7): a continue card for the
 * board last opened, own boards, then boards shared with them. Each group is sorted by name so
 * a renamed board moves where the user expects it.
 */
export function BoardHome() {
  const { t, i18n } = useTranslation();
  const { effectiveRole } = useEnumLabels();
  const boards = useBoards();
  const me = useMe();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const { own, shared, continueBoard } = useMemo(() => {
    const collator = new Intl.Collator(i18n.language, { sensitivity: 'base', numeric: true });
    const sorted = [...(boards.data ?? [])].sort((a, b) => collator.compare(a.name, b.name));
    const lastBoardId = me.data?.preferences.lastBoardId;
    return {
      own: sorted.filter((board) => board.currentUserRole === 'OWNER'),
      shared: sorted.filter((board) => board.currentUserRole !== 'OWNER'),
      continueBoard: sorted.find((board) => board.id === lastBoardId),
    };
  }, [boards.data, me.data, i18n.language]);

  // Keeps the dialog mounted while it animates out.
  const close = (open: boolean) => setDialog((current) => (current ? { ...current, open } : null));
  const openCreate = () => setDialog({ kind: 'create', open: true });
  // After a delete or leave the row and its button are gone: continue from the heading.
  const restoreFocus = (confirmed: boolean) => {
    const opener = dialog && dialog.kind !== 'create' ? dialog.opener : null;
    if (!confirmed && opener?.isConnected) opener.focus();
    else headingRef.current?.focus();
  };

  let content;
  // Waits for the profile too: the continue card sits above the list, and painting it a moment
  // later would shift every row. A failed profile load just means no continue card.
  if (boards.isLoading || me.isLoading) {
    content = (
      <div role="status" aria-label={t('common.loading')} className="flex flex-col gap-2">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-2/3" />
      </div>
    );
  } else if (boards.isError || !boards.data) {
    content = (
      <EmptyState
        icon={<CloudOff strokeWidth={1.75} />}
        title={t('routes.home.loadFailed')}
        action={
          <Button variant="outline" onClick={() => void boards.refetch()}>
            <RotateCcw strokeWidth={1.75} />
            {t('common.retry')}
          </Button>
        }
      />
    );
  } else if (boards.data.length === 0) {
    content = (
      <EmptyState
        icon={<LayoutGrid strokeWidth={1.75} />}
        title={t('home.empty.title')}
        hint={t('home.empty.hint')}
        action={
          <Button variant="accent" onClick={openCreate}>
            <Plus strokeWidth={1.75} />
            {t('home.newBoard')}
          </Button>
        }
      />
    );
  } else {
    const row = (board: WhiteboardSummaryDto) => (
      <BoardRow
        key={board.id}
        board={board}
        onDelete={(opener) => setDialog({ kind: 'delete', board, open: true, opener })}
        onLeave={(opener) => setDialog({ kind: 'leave', board, open: true, opener })}
      />
    );
    content = (
      <div className="flex flex-col gap-8">
        {continueBoard && (
          <Link
            to={`/boards/${continueBoard.id}`}
            className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 shadow-e1 transition-colors duration-100 hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-12 font-medium text-fg-3">{t('home.continue')}</span>
              <span className="truncate text-16 font-medium text-fg-1">{continueBoard.name}</span>
            </span>
            {continueBoard.currentUserRole !== 'OWNER' && (
              <span className="shrink-0 text-12 text-fg-faint">
                {effectiveRole[continueBoard.currentUserRole]}
              </span>
            )}
            <ArrowRight
              aria-hidden
              className="h-4 w-4 shrink-0 text-fg-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg-1"
              strokeWidth={1.75}
            />
          </Link>
        )}

        <section className="flex flex-col gap-1">
          {own.length > 0 && <ul className="-mx-1 flex flex-col">{own.map(row)}</ul>}
          {/* "Add one here": right after the boards it adds to. */}
          <button
            type="button"
            onClick={openCreate}
            className="mt-1 flex h-11 items-center gap-2 rounded-lg border border-dashed border-border px-3 text-14 text-fg-3 transition-colors duration-100 hover:border-border-strong hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] [@media(pointer:coarse)]:h-12"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {t('home.newBoard')}
          </button>
        </section>

        {shared.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-12 font-medium text-fg-3">{t('home.shared')}</h2>
            <ul className="-mx-1 flex flex-col">{shared.map(row)}</ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center justify-between gap-3">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-20 font-semibold text-fg-1 focus:outline-none sm:text-28"
        >
          {t('home.title')}
        </h1>
        {/* Reached first when tabbing through the page; the empty state has its own. */}
        {boards.data && boards.data.length > 0 && (
          <Button variant="outline" size="sm" onClick={openCreate}>
            <Plus strokeWidth={1.75} />
            {t('home.newBoard')}
          </Button>
        )}
      </div>
      {content}

      {dialog?.kind === 'create' && <NewBoardDialog open={dialog.open} onOpenChange={close} />}
      {dialog?.kind === 'delete' && (
        <DeleteBoardDialog
          board={dialog.board}
          open={dialog.open}
          onOpenChange={close}
          onRestoreFocus={restoreFocus}
        />
      )}
      {dialog?.kind === 'leave' && (
        <LeaveBoardDialog
          board={dialog.board}
          open={dialog.open}
          onOpenChange={close}
          onRestoreFocus={restoreFocus}
        />
      )}
    </div>
  );
}
