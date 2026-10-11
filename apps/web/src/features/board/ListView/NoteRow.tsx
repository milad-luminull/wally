import type { MouseEvent } from 'react';
import type { NoteDto } from '@wally/shared';
import { useTranslation } from 'react-i18next';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/cn';
import { dueInfo, dueToneClass, noteColourFillClass, subtaskCountLabel } from '../util/noteDerived';
import { PriorityDot } from '../PriorityDot';

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

  const assigneeName =
    note.assignee && note.assignee.id !== currentUserId
      ? (note.assignee.displayName ?? note.assignee.email)
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
        'group/row relative flex cursor-pointer items-start gap-3.5 px-4 py-3',
        'border-b border-border-subtle last:border-b-0',
        // A note is coloured all over in the list too, so the same note is the same object
        // in both views. Hover darkens the fill rather than replacing it, which a
        // `hover:bg-*` could not do without painting over the note's own colour.
        noteColourFillClass[note.colour],
        'transition-[filter] duration-150 ease-ds hover:brightness-[0.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ring-alpha)]',
        isDone && 'opacity-60',
      )}
    >
      <Checkbox
        checked={isDone}
        onClick={handleCheckboxClick}
        disabled={!canEdit}
        aria-label={isDone ? 'Als offen markieren' : 'Als erledigt markieren'}
        className="mt-0.5 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'text-14 font-semibold leading-snug text-fg-1',
            isDone && 'line-through decoration-fg-faint',
          )}
        >
          {note.title || 'Ohne Titel'}
        </div>

        {(metaParts.length > 0 || note.tags.length > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {metaParts.length > 0 && (
              <span className="truncate text-12 text-fg-meta-on-note">
                {metaParts.join('  ·  ')}
              </span>
            )}
            {note.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-[color:var(--chip-on)] px-1.5 py-0.5 text-12 font-medium text-fg-meta-on-note"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5 pt-0.5">
        <span
          className={cn('whitespace-nowrap text-12 tabular-nums', dueToneClass[due.tone])}
          style={{ fontWeight: due.weight }}
        >
          {due.label}
        </span>
        {!isDone && (
          <PriorityDot
            priority={note.priority}
            className="mt-1.5"
            label={t('board.priorityPrefix', { label: priorityLabels[note.priority] })}
          />
        )}
      </div>
    </div>
  );
}
