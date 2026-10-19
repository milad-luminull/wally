import { ChartNoAxesColumn, Columns3, PanelLeft, Plus } from 'lucide-react';
import { useState, type SVGProps } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { NoteVisibility } from '@wally/shared';
import { BrandMark } from '@/components/BrandMark';
import { AccountMenu } from './AccountMenu';
import { BoardSwitcher } from './BoardSwitcher';
import type { BoardAxis } from './hooks/useBoardViewState';

function WhiteboardIcon(props: SVGProps<SVGSVGElement> & { size?: number }) {
  const { size = 15, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <rect x="3" y="3" width="8" height="7" rx="1.5" transform="rotate(-4 7 6.5)" />
      <rect x="13" y="6" width="8" height="7" rx="1.5" transform="rotate(5 17 9.5)" />
      <rect x="6" y="14" width="8" height="7" rx="1.5" />
    </svg>
  );
}

interface Props {
  boardId: string;
  boardName: string;
  axis: BoardAxis;
  onSetAxis: (axis: BoardAxis) => void;
  onNewNote: () => void;
  newNoteVisibility: NoteVisibility;
}
export function BoardRail({
  boardId,
  boardName,
  axis,
  onSetAxis,
  onNewNote,
  newNoteVisibility,
}: Props) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const toggleLabel = t(collapsed ? 'board.rail.expand' : 'board.rail.collapse');
  const links = [
    {
      key: 'horizon',
      icon: Columns3,
      axis: 'horizon' as const,
      label: t('board.topBar.axis.horizon.label'),
    },
    {
      key: 'priority',
      icon: ChartNoAxesColumn,
      axis: 'priority' as const,
      label: t('board.topBar.axis.priority.label'),
    },
    {
      key: 'free',
      icon: WhiteboardIcon,
      axis: 'free' as const,
      label: t('board.rail.whiteboard'),
    },
  ];
  const newLabel = t(
    newNoteVisibility === 'PRIVATE' ? 'board.topBar.newPrivateNote' : 'board.topBar.newNote',
  );
  return (
    <aside className="board-rail" data-collapsed={collapsed}>
      <div className="board-rail-header">
        <Link to="/boards" className="board-rail-brand" aria-label={t('board.topBar.home')}>
          <BrandMark size={20} />
          <span>{t('welcome.brand')}</span>
          <small className="board-rail-byline">{t('welcome.byline')}</small>
        </Link>
        <button
          type="button"
          className="board-rail-toggle"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!collapsed}
          aria-controls="board-rail-navigation"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? (
            <BrandMark size={20} />
          ) : (
            <PanelLeft size={15} strokeWidth={1.9} aria-hidden />
          )}
        </button>
      </div>
      <BoardSwitcher boardId={boardId} boardName={boardName} variant="rail" />
      <nav id="board-rail-navigation" aria-label={t('board.rail.views')} className="board-rail-nav">
        {links.map(({ key, icon: Icon, axis: nextAxis, label }) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            title={collapsed ? label : undefined}
            aria-current={axis === nextAxis ? 'page' : undefined}
            onClick={() => onSetAxis(nextAxis)}
          >
            <Icon size={15} strokeWidth={1.8} aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="board-rail-bottom">
        <button
          className="board-rail-new"
          type="button"
          onClick={onNewNote}
          aria-label={newLabel}
          title={collapsed ? newLabel : undefined}
        >
          <Plus size={18} />
          <span>{newLabel}</span>
          <kbd aria-hidden>{'N'}</kbd>
        </button>
        <div className="board-rail-account">
          <AccountMenu showName={!collapsed} />
        </div>
      </div>
    </aside>
  );
}
