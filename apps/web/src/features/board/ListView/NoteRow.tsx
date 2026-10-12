import type { MouseEvent } from 'react';
import type { NoteDto } from '@wally/shared';
import { useTranslation } from 'react-i18next';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/cn';
import { dueInfo, dueToneClass, noteColourFillClass, subtaskCountLabel } from '../util/noteDerived';
import { PriorityIcon } from '../PriorityIcon';

interface NoteRowProps {
  note: NoteDto;
  currentUserId: string | undefined;
  onOpen: () => void;
  onToggleDone: () => void;
  canEdit: boolean;
}

export function NoteRow({ note, currentUserId, onOpen, onToggleDone, canEdit }: NoteRowProps) {
  const { t } = useTranslation();
  const { priority: priorityLabels } = useEnumLabels();
  const due = dueInfo(note, t);
  const checklistLabel = subtaskCountLabel(note.subtaskSummary);
  const isDone = note.status === 'DONE';

  // Always named, yourself included: leaving your own name out made "assigned to me" read
  // exactly like "assigned to nobody".
  const assigneeName = note.assignee
    ? note.assignee.id === currentUserId
      ? t('common.you')
      : (note.assignee.displayName ?? note.assignee.email)
    : undefined;
  // First property alphabetically, so the meta line is stable rather than following
  // whatever order Firestore returns the map in.
  const [firstField] = Object.entries(note.customFields ?? {}).sort(([a], [b]) =>
    a.localeCompare(b, 'de'),
  );
  const fieldLabel = firstField ? `${firstField[0]}: ${firstField[1]}` : undefined;
  const metaParts = [fieldLabel, assigneeName, checklistLabel || undefined].filter(Boolean);

  function handleCheckboxClick(e: MouseEvent) {
    e.stopPropagation();
    onToggleDone();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group/row relative flex min-h-10 cursor-pointer items-center gap-3 px-3 py-2',
        'border-b border-border-subtle last:border-b-0',
        'transition-colors duration-100 hover:bg-surface-alt',
        'focus-visible:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ring-alpha)]',
        '[@media(pointer:coarse)]:min-h-12',
      )}
    >
      <Checkbox
        checked={isDone}
        onClick={handleCheckboxClick}
        disabled={!canEdit}
        aria-label={isDone ? t('board.rowStatus.markOpen') : t('board.rowStatus.markDone')}
        className="shrink-0"
      />

      {/* The note's colour as a swatch: the same note is the same object in both views,
          without painting a whole row of the list. White notes need no marker. */}
      {note.colour !== 'WEISS' && (
        <span
          aria-hidden
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-[3px] border border-[color:var(--note-border)]',
            noteColourFillClass[note.colour],
          )}
        />
      )}

      <div
        className={cn(
          'flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1',
          isDone && 'opacity-55',
        )}
      >
        <span
          className={cn(
            'min-w-0 truncate text-13 font-medium text-fg-1',
            isDone && 'line-through decoration-fg-faint',
          )}
        >
          {note.title || t('common.untitled')}
        </span>

        {metaParts.length > 0 && (
          <span className="truncate text-12 text-fg-3">{metaParts.join(' · ')}</span>
        )}
        {note.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-[4px] border border-border bg-surface-alt px-1.5 text-12 leading-5 text-fg-2"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className={cn('flex shrink-0 items-center gap-2.5', isDone && 'opacity-55')}>
        <span
          className={cn('whitespace-nowrap text-12 tabular-nums', dueToneClass[due.tone])}
          style={{ fontWeight: due.weight }}
        >
          {due.label}
        </span>
        {!isDone && (
          <PriorityIcon
            priority={note.priority}
            label={t('board.priorityPrefix', { label: priorityLabels[note.priority] })}
          />
        )}
      </div>
    </div>
  );
}
