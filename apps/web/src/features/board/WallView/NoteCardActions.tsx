import { useRef, useState } from 'react';
import { Copy, Maximize2, MoreHorizontal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MenuItem } from '@/components/ui/menu';

export interface NoteCardActions {
  onExpand: () => void;
  /** Omitted for notes this member cannot edit. */
  onDuplicate?: () => void;
  onDelete?: () => void;
}

/** Siblings of the card button: quick actions never start a drag or open the side panel. */
export function NoteCardQuickActions({ actions }: { actions: NoteCardActions }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const afterClose = useRef<(() => void) | null>(null);
  function run(action: () => void) {
    afterClose.current = action;
    setOpen(false);
  }
  return (
    <div
      className="paper-note-actions"
      data-open={open || undefined}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={t('note.expand')}
        title={t('note.expand')}
        onClick={actions.onExpand}
      >
        <Maximize2 aria-hidden size={13} strokeWidth={2} />
      </button>
      {(actions.onDuplicate || actions.onDelete) && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label={t('note.actions')} title={t('note.actions')}>
              <MoreHorizontal aria-hidden size={16} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={6}
            className="z-overlay w-48 p-1"
            onCloseAutoFocus={(event) => {
              const action = afterClose.current;
              if (!action) return;
              // Finish menu teardown before opening the copy or removing its trigger.
              event.preventDefault();
              afterClose.current = null;
              action();
            }}
          >
            {actions.onDuplicate && (
              <MenuItem icon={<Copy />} onClick={() => run(actions.onDuplicate!)}>
                {t('note.duplicate')}
              </MenuItem>
            )}
            {actions.onDelete && (
              <MenuItem destructive icon={<Trash2 />} onClick={() => run(actions.onDelete!)}>
                {t('common.delete')}
              </MenuItem>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
