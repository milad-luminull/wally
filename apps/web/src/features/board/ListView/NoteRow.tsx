import type { MouseEvent } from 'react';
import type { NoteDto } from '@wally/shared';
import { useTranslation } from 'react-i18next';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/cn';
import {
  dueInfo,
  dueToneClass,
  noteColourSpineClass,
  priorityToneClass,
  subtaskCountLabel,
} from '../util/noteDerived';

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
  const [firstField] = Object.entries(note.customFields ?? {}).sort(([a], [b]) => a.localeCompare(b, 'de'));
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
        'group/row relative flex cursor-pointer items-start gap-3.5 py-3 pl-5 pr-4',
        'border-b border-border-subtle last:border-b-0',
        'transition-colors duration-150 ease-ds hover:bg-inset-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ring-alpha)]',
        isDone && 'opacity-60',
      )}
    >
      {/* Same colour spine as the Wand card, so a note is recognisable across both views. */}
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-[3px]', noteColourSpineClass[note.colour])}
      />

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
            'font-head text-14 font-semibold leading-snug text-fg-1',
            isDone && 'line-through decoration-fg-faint',
          )}
        >
          {note.title || 'Ohne Titel'}
        </div>

        {(metaParts.length > 0 || note.tags.length > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {metaParts.length > 0 && (
              <span className="truncate text-12 text-fg-muted">{metaParts.join('  ·  ')}</span>
            )}
            {note.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-inset px-1.5 py-0.5 text-11 font-medium text-fg-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5 pt-0.5">
        <span className={cn('whitespace-nowrap text-12 tabular-nums', dueToneClass[due.tone])} style={{ fontWeight: due.weight }}>
          {due.label}
        </span>
        {note.priority === 'HOCH' && !isDone && (
          <span
            role="img"
            aria-label={`Priorität: ${priorityLabels.HOCH}`}
            className={cn('mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full', priorityToneClass.HOCH)}
          />
        )}
      </div>
    </div>
  );
}
