import { CalendarRange, Columns3, LayoutGrid, List, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { NoteVisibility } from '@wally/shared';
import { BrandMark } from '@/components/BrandMark';
import { AccountMenu } from './AccountMenu';
import { BoardSwitcher } from './BoardSwitcher';
import type { BoardAxis, BoardView } from './hooks/useBoardViewState';

interface Props {
  boardId: string;
  boardName: string;
  view: BoardView;
  axis: BoardAxis;
  onSetLayout: (view: BoardView, axis: BoardAxis) => void;
  onNewNote: () => void;
  newNoteVisibility: NoteVisibility;
}
export function BoardRail({
  boardId,
  boardName,
  view,
  axis,
  onSetLayout,
  onNewNote,
  newNoteVisibility,
}: Props) {
  const { t } = useTranslation();
  const links = [
    { key: 'list', icon: List, view: 'list' as const, axis, label: t('board.topBar.view.list') },
    {
      key: 'horizon',
      icon: CalendarRange,
      view: 'wand' as const,
      axis: 'horizon' as const,
      label: t('board.topBar.axis.horizon.label'),
    },
    {
      key: 'priority',
      icon: Columns3,
      view: 'wand' as const,
      axis: 'priority' as const,
      label: t('board.topBar.axis.priority.label'),
    },
    {
      key: 'free',
      icon: LayoutGrid,
      view: 'wand' as const,
      axis: 'free' as const,
      label: t('board.rail.whiteboard'),
    },
  ];
  const newLabel = t(
    newNoteVisibility === 'PRIVATE' ? 'board.topBar.newPrivateNote' : 'board.topBar.newNote',
  );
  return (
    <aside className="board-rail">
      <Link to="/boards" className="board-rail-brand" aria-label={t('board.topBar.home')}>
        <BrandMark size={23} />
        <span>{t('welcome.brand')}</span>
      </Link>
      <div className="board-rail-switcher">
        <div className="min-w-0 flex-1">
          <span>{t('board.rail.wall')}</span>
          <p title={boardName}>{boardName}</p>
        </div>
        <BoardSwitcher boardId={boardId} />
      </div>
      <nav aria-label={t('board.rail.views')} className="board-rail-nav">
        {links.map(({ key, icon: Icon, view: nextView, axis: nextAxis, label }) => (
          <button
            key={key}
            type="button"
            aria-current={
              view === nextView && (view === 'list' || axis === nextAxis) ? 'page' : undefined
            }
            onClick={() => onSetLayout(nextView, nextAxis)}
          >
            <Icon size={17} strokeWidth={1.6} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="board-rail-bottom">
        <button className="board-rail-new" type="button" onClick={onNewNote}>
          <Plus size={18} />
          <span>{newLabel}</span>
          <kbd aria-hidden>{'N'}</kbd>
        </button>
        <div className="board-rail-account">
          <span>{t('welcome.byline')}</span>
          <AccountMenu />
        </div>
      </div>
    </aside>
  );
}
