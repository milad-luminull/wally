import { Columns3, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '@/components/ui/segmented';
import type { BoardView } from './hooks/useBoardViewState';

export function BoardViewToggle({
  view,
  onSetView,
}: {
  view: BoardView;
  onSetView: (view: BoardView) => void;
}) {
  const { t } = useTranslation();
  return (
    <Segmented
      aria-label={t('board.topBar.view.ariaLabel')}
      className="board-view-toggle"
      value={view}
      onChange={onSetView}
      options={[
        { value: 'list', label: t('board.topBar.view.list'), icon: <List aria-hidden /> },
        { value: 'wall', label: t('board.topBar.view.wall'), icon: <Columns3 aria-hidden /> },
      ]}
    />
  );
}
