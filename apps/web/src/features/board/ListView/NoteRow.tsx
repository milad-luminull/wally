import type { MouseEvent } from 'react';
import type { NoteDto } from '@wally/shared';
import { PRIORITY_LABELS } from '@wally/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/cn';
import { dueInfo, dueToneClass, priorityToneClass, subtaskCountLabel } from '../util/noteDerived';

interface NoteRowProps {
  note: NoteDto;
  currentUserId: string | undefined;
  onOpen: () => void;
  onToggleDone: () => void;
  canEdit: boolean;
}

export function NoteRow({ note, currentUserId, onOpen, onToggleDone, canEdit }: NoteRowProps) {
  const due = dueInfo(note);
  const checklistLabel = subtaskCountLabel(note.subtaskSummary);
  const metaParts = [
    note.referenceLabel || undefined,
    note.assignee && note.assignee.id !== currentUserId ? note.assignee.displayName ?? note.assignee.email : undefined,
    checklistLabel || undefined,
    note.tags.length ? note.tags.join(' · ') : undefined,
  ].filter(Boolean);

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
        'flex cursor-pointer items-start gap-3.5 border-b border-border-subtle py-3.5 transition-colors duration-150 hover:bg-surface-alt',
        note.status === 'DONE' && 'opacity-55',
      )}
    >
      <Checkbox
        checked={note.status === 'DONE'}
        onClick={handleCheckboxClick}
        disabled={!canEdit}
        aria-label={note.status === 'DONE' ? 'Als offen markieren' : 'Als erledigt markieren'}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className={cn('font-head text-14 font-semibold leading-snug text-fg-1', note.status === 'DONE' && 'line-through')}>
          {note.title || 'Ohne Titel'}
        </div>
        <div className="mt-0.5 truncate text-12 text-fg-muted">{metaParts.length ? metaParts.join('  ·  ') : '—'}</div>
      </div>
      <span className={cn('shrink-0 text-12 tabular-nums', dueToneClass[due.tone])} style={{ fontWeight: due.weight }}>
        {due.label}
      </span>
      {note.priority === 'HOCH' && note.status !== 'DONE' && (
        <span
          role="img"
          aria-label={`Priorität: ${PRIORITY_LABELS.HOCH}`}
          className={cn('mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full', priorityToneClass.HOCH)}
        />
      )}
    </div>
  );
}
