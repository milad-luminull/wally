import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LogOut, MoreHorizontal, Trash2 } from 'lucide-react';
import type { WhiteboardSummaryDto } from '@wally/shared';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MenuItem } from '@/components/ui/menu';
import { useEnumLabels } from '@/i18n/enumLabels';

/**
 * One board on the home: the whole row opens it, and a trailing menu holds the single way out
 * of it — delete for an own board, leave for a shared one (RFC BOARD_HOME §7.3). Rename stays
 * in the board's own top bar, so there is one place to rename.
 */
export function BoardRow({
  board,
  onDelete,
  onLeave,
}: {
  board: WhiteboardSummaryDto;
  onDelete: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const { effectiveRole } = useEnumLabels();
  const [menuOpen, setMenuOpen] = useState(false);
  const own = board.currentUserRole === 'OWNER';

  return (
    <li className="group flex items-center gap-1 rounded-lg transition-colors duration-100 hover:bg-inset focus-within:bg-inset">
      <Link
        to={`/boards/${board.id}`}
        aria-label={t('home.open', { name: board.name })}
        title={board.name}
        className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-14 text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] [@media(pointer:coarse)]:h-12"
      >
        <span className="min-w-0 flex-1 truncate">{board.name}</span>
        {!own && (
          <span className="shrink-0 text-12 text-fg-faint">
            {effectiveRole[board.currentUserRole]}
          </span>
        )}
      </Link>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          aria-label={t('home.rowMenu', { name: board.name })}
          className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors duration-100 hover:bg-surface hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] data-[state=open]:bg-surface data-[state=open]:text-fg-1 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 p-1">
          {own ? (
            <MenuItem
              destructive
              icon={<Trash2 strokeWidth={1.75} />}
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              {t('home.delete.action')}
            </MenuItem>
          ) : (
            <MenuItem
              destructive
              icon={<LogOut strokeWidth={1.75} />}
              onClick={() => {
                setMenuOpen(false);
                onLeave();
              }}
            >
              {t('home.leave.action')}
            </MenuItem>
          )}
        </PopoverContent>
      </Popover>
    </li>
  );
}
