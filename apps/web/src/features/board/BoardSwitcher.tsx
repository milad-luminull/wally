import { useState } from 'react';
import { Check, ChevronsUpDown, LayoutGrid, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';
import { useTranslation } from 'react-i18next';
import { useEnumLabels } from '@/i18n/enumLabels';
import { MenuItem, MenuSeparator } from '@/components/ui/menu';
import { NewBoardDialog } from '@/features/boards/NewBoardDialog';
import { useBoards } from './hooks/useBoards';

/**
 * Lets a member reach a board they do not own. Until this existed, `useBoards` was consumed
 * only by RootRedirect — which always prefers the board you own — so an activated invite
 * was invisible: the user landed on their own wall with no route to the shared one, and no
 * invite email carrying a link either.
 *
 * Renders for every user, even with a single board: below the list it leads to the board
 * home and opens the New board dialog, which is the only hint on a board that more boards are
 * possible (RFC BOARD_HOME §11).
 */
export function BoardSwitcher({ boardId }: { boardId: string }) {
  const { t } = useTranslation();
  const { effectiveRole } = useEnumLabels();
  const { data: boards } = useBoards();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  if (!boards) return null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={t('board.switcherAria')}
          title={t('board.switcherAria')}
          className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors duration-100 hover:bg-inset hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] data-[state=open]:bg-inset data-[state=open]:text-fg-1 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" strokeWidth={1.75} />
        </PopoverTrigger>

        {/* Above z-header: the trigger sits inside the header, so the panel opens partly
            behind it at PopoverContent's default z-dropdown and clips its own first row.
            Scoped here rather than raised on the shared primitive, which other callers
            position clear of the chrome. */}
        <PopoverContent align="start" className="z-overlay w-64 p-1">
          <p className="px-2 pb-1 pt-1.5 text-12 font-medium text-fg-3">
            {t('board.switcherHeading')}
          </p>
          <ul className="flex flex-col">
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
                      'flex h-8 items-center gap-2 rounded-[5px] px-2 text-13 transition-colors duration-100 hover:bg-inset focus-visible:bg-inset focus-visible:outline-none [@media(pointer:coarse)]:h-11',
                      current ? 'font-medium text-fg-1' : 'text-fg-2 hover:text-fg-1',
                    )}
                  >
                    <Check
                      className={cn('h-3.5 w-3.5 shrink-0', current ? 'text-fg-1' : 'invisible')}
                      strokeWidth={2}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{board.name}</span>
                    <span className="shrink-0 text-12 text-fg-faint">
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
          <MenuSeparator />
          <Link
            to="/boards"
            className="flex h-8 items-center gap-2 rounded-[5px] px-2 text-13 text-fg-2 transition-colors duration-100 hover:bg-inset hover:text-fg-1 focus-visible:bg-inset focus-visible:outline-none [@media(pointer:coarse)]:h-11"
          >
            <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-fg-3" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('board.switcher.all')}</span>
          </Link>
          <MenuItem
            icon={<Plus strokeWidth={1.75} />}
            className="text-fg-2"
            onClick={() => {
              // Close the popover first, so focus returns from the dialog to the trigger.
              setOpen(false);
              setCreating(true);
            }}
          >
            {t('home.newBoard')}
          </MenuItem>
        </PopoverContent>
      </Popover>
      <NewBoardDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
