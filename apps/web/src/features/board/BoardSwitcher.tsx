import { Check, ChevronsUpDown } from 'lucide-react';
import { Link } from 'react-router';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { useTranslation } from 'react-i18next';
import { useEnumLabels } from '@/i18n/enumLabels';
import { useBoards } from './hooks/useBoards';

/**
 * Lets a member reach a board they do not own. Until this existed, `useBoards` was consumed
 * only by RootRedirect — which always prefers the board you own — so an activated invite
 * was invisible: the user landed on their own wall with no route to the shared one, and no
 * invite email carrying a link either.
 *
 * Renders nothing while the caller has only their own board, so the solo case keeps the
 * plain title it has now.
 */
export function BoardSwitcher({ boardId }: { boardId: string }) {
  const { t } = useTranslation();
  const { effectiveRole } = useEnumLabels();
  const { data: boards } = useBoards();

  if (!boards || boards.length < 2) return null;

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('board.switcherAria')}
        title={t('board.switcherAria')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-inset hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-alt [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"
      >
        <ChevronsUpDown className="h-3.5 w-3.5" strokeWidth={2} />
      </PopoverTrigger>

      {/* Above z-header: the trigger sits inside the header, so the panel opens partly
            behind it at PopoverContent's default z-dropdown and clips its own first row.
            Scoped here rather than raised on the shared primitive, which other callers
            position clear of the chrome. */}
      <PopoverContent align="start" className="z-overlay w-64 p-0">
        <p className="border-b border-border-subtle px-4 py-2.5 text-12 font-semibold uppercase tracking-wide text-fg-muted">
          {t('board.switcherHeading')}
        </p>
        <ul className="flex flex-col p-1.5">
          {boards.map((board) => {
            const current = board.id === boardId;
            return (
              <li key={board.id}>
                <Link
                  // A bare path: each board restores its own saved view settings, so
                  // carrying this board's query string over would be wrong.
                  to={`/boards/${board.id}`}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-14 transition-colors duration-150 hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
                    current ? 'font-semibold text-fg-1' : 'font-medium text-fg-2 hover:text-fg-1',
                  )}
                >
                  <Check
                    className={cn('h-3.5 w-3.5 shrink-0', current ? 'text-fg-1' : 'invisible')}
                    strokeWidth={2.2}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{board.name}</span>
                  <span className="shrink-0 text-12 text-fg-muted">
                    {/* OWNER gets its own key rather than enums.effectiveRole.OWNER: in a
                        list of boards "your board" reads better than "owner". */}
                    {board.currentUserRole === 'OWNER'
                      ? t('board.switcher.ownRole')
                      : effectiveRole[board.currentUserRole]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
