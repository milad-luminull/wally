import { useRef, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Copy,
  LockKeyhole,
  Maximize2,
  MoreHorizontal,
  PanelRight,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MenuItem, MenuSeparator } from '@/components/ui/menu';

export interface NoteCardActions {
  onOpen: () => void;
  onExpand: () => void;
  isDone?: boolean;
  onToggleStatus?: () => void;
  onMakePrivate?: () => void;
  /** Omitted for notes this member cannot edit. */
  onDuplicate?: () => void;
  onDelete?: () => void;
}

/** Siblings of the card button: quick actions never start a drag or accidentally open the side panel. */
export function NoteCardQuickActions({ actions }: { actions: NoteCardActions }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const afterClose = useRef<{ action: () => void; restoreFocus: boolean } | null>(null);
  function run(action: () => void, restoreFocus = false) {
    afterClose.current = { action, restoreFocus };
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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label={t('note.actions')}
            title={t('note.actions')}
          >
            <MoreHorizontal aria-hidden size={16} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="z-overlay w-48 p-1"
          onCloseAutoFocus={(event) => {
            const pending = afterClose.current;
            if (!pending) return;
            // Finish menu teardown before opening the copy or removing its trigger.
            event.preventDefault();
            afterClose.current = null;
            if (pending.restoreFocus) triggerRef.current?.focus();
            pending.action();
          }}
        >
          <MenuItem icon={<PanelRight />} onClick={() => run(actions.onOpen)}>
            {t('note.open')}
          </MenuItem>
          {(actions.onToggleStatus || actions.onMakePrivate || actions.onDuplicate) && (
            <MenuSeparator />
          )}
          {actions.onToggleStatus && (
            <MenuItem
              icon={actions.isDone ? <Circle /> : <CheckCircle2 />}
              onClick={() => run(actions.onToggleStatus!, true)}
            >
              {t(actions.isDone ? 'board.rowStatus.markOpen' : 'board.rowStatus.markDone')}
            </MenuItem>
          )}
          {actions.onMakePrivate && (
            <MenuItem icon={<LockKeyhole />} onClick={() => run(actions.onMakePrivate!, true)}>
              {t('note.makePrivate')}
            </MenuItem>
          )}
          {actions.onDuplicate && (
            <MenuItem icon={<Copy />} onClick={() => run(actions.onDuplicate!)}>
              {t('note.duplicate')}
            </MenuItem>
          )}
          {actions.onDelete && <MenuSeparator />}
          {actions.onDelete && (
            <MenuItem destructive icon={<Trash2 />} onClick={() => run(actions.onDelete!)}>
              {t('common.delete')}
            </MenuItem>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
