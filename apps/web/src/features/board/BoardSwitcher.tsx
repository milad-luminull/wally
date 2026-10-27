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
 * possible (RFC 0002 §11).
 */
interface BoardSwitcherProps {
  boardId: string;
  boardName?: string;
  variant?: 'icon' | 'rail';
}

// Stable visual identities for the existing boards; no new saved colour setting.
const swatches = [
  '--note-butter',
  '--note-minze',
  '--note-himmel',
  '--note-rose',
  '--note-flieder',
];
function boardSwatch(id: string) {
  const index =
    [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % swatches.length;
  return `var(${swatches[index]})`;
}

export function BoardSwitcher({ boardId, boardName, variant = 'icon' }: BoardSwitcherProps) {
  const { t } = useTranslation();
  const { effectiveRole } = useEnumLabels();
  const { data: boards } = useBoards();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const rail = variant === 'rail';
  const currentName =
    boardName ?? boards?.find((board) => board.id === boardId)?.name ?? t('board.rail.wall');
  if (!boards && !rail) return null;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={t('board.switcherAria')}
          title={t('board.switcherAria')}
          aria-description={rail ? currentName : undefined}
          className={
            rail
              ? 'board-wall-selector'
              : 'flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors duration-100 hover:bg-inset hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] data-[state=open]:bg-inset data-[state=open]:text-fg-1 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9'
          }
        >
          {rail && (
            <>
              <span
                className="board-wall-swatch"
                style={{ background: boardSwatch(boardId) }}
                aria-hidden
              />
              <span className="board-wall-selector-label">
                <span>{t('board.rail.wall')}</span>
                <strong>{currentName}</strong>
              </span>
            </>
          )}
          <ChevronsUpDown aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
        </PopoverTrigger>

        {/* Above z-header: the trigger sits inside the header, so the panel opens partly
            behind it at PopoverContent's default z-dropdown and clips its own first row.
            Scoped here rather than raised on the shared primitive, which other callers
            position clear of the chrome. */}
        <PopoverContent
          align="start"
          sideOffset={6}
          className={cn('z-overlay w-64 p-1', rail && 'board-wall-menu')}
        >
          <p className={rail ? 'sr-only' : 'px-2 pb-1 pt-1.5 text-12 font-medium text-fg-3'}>
            {t('board.switcherHeading')}
          </p>
          <ul className="flex flex-col">
            {boards?.map((board) => {
              const current = board.id === boardId;
              return (
                <li key={board.id}>
                  <Link
                    // A bare path: each board restores its own saved view settings, so
                    // carrying this board's query string over would be wrong.
                    to={`/boards/${board.id}`}
                    onClick={() => setOpen(false)}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-[5px] px-2 text-13 transition-colors duration-100 hover:bg-inset focus-visible:bg-inset focus-visible:outline-none [@media(pointer:coarse)]:h-11',
                      rail && 'board-wall-menu-item',
                      current ? 'font-medium text-fg-1' : 'text-fg-2 hover:text-fg-1',
                    )}
                  >
                    <span
                      className="board-wall-menu-swatch"
                      style={{ background: boardSwatch(board.id) }}
                      aria-hidden
                    />
                    <span className="board-wall-menu-name min-w-0 flex-1">
                      <span className="block truncate">{board.name}</span>
                      <span className="board-wall-menu-role">
                        {/* OWNER gets its own key rather than enums.effectiveRole.OWNER: in a
                        list of boards "your board" reads better than "owner". */}
                        {board.currentUserRole === 'OWNER'
                          ? t('board.switcher.ownRole')
                          : effectiveRole[board.currentUserRole]}
                      </span>
                    </span>
                    <Check
                      className={cn('h-3.5 w-3.5 shrink-0', current ? 'text-fg-1' : 'invisible')}
                      strokeWidth={2}
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
          <MenuSeparator />
          <Link
            to="/boards"
            onClick={() => setOpen(false)}
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
