import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties } from 'react';
import type { NoteDto } from '@wally/shared';
import { PRIORITY_LABELS } from '@wally/shared';
import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/lib/useReducedMotion';
import {
  dueInfo,
  dueToneClass,
  initialsOf,
  noteColourBorderClass,
  priorityToneClass,
  subtaskCountLabel,
} from '../util/noteDerived';

interface NoteCardProps {
  note: NoteDto;
  currentUserId: string | undefined;
  selected: boolean;
  onOpen: () => void;
  style?: CSSProperties;
}

/** A draggable note card. Positioning (absolute for Frei mode, static flow for zoned
 * columns/rows) is entirely the caller's concern via `style` — this component only knows
 * how to render itself and report drag deltas through dnd-kit. */
export function NoteCard({ note, currentUserId, selected, onOpen, style }: NoteCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: note.id });
  const reducedMotion = useReducedMotion();
  const due = dueInfo(note);
  const checklistLabel = subtaskCountLabel(note.subtaskSummary);
  const showAssignee = note.assignee && note.assignee.id !== currentUserId;
  const showPriorityDot = note.priority === 'HOCH' && note.status !== 'DONE';

  const dragStyle: CSSProperties = {
    ...style,
    transform: transform ? CSS.Translate.toString(transform) : style?.transform,
    zIndex: isDragging ? 30 : selected ? 20 : style?.zIndex,
    transition: isDragging || reducedMotion ? undefined : 'transform 150ms cubic-bezier(0.2,0.7,0.2,1)',
  };

  return (
    <div ref={setNodeRef} style={dragStyle} data-note-id={note.id}>
      <button
        type="button"
        {...listeners}
        {...attributes}
        onClick={onOpen}
        className={cn(
          'flex w-[216px] cursor-grab flex-col gap-3 rounded-xl border border-l-[3px] bg-card p-4 text-left shadow-none select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
          selected ? 'border-primary' : 'border-border',
          noteColourBorderClass[note.colour],
          isDragging && 'cursor-grabbing shadow-e2',
          note.status === 'DONE' && 'opacity-55',
        )}
      >
        <span
          className={cn(
            'font-head text-14 font-semibold leading-snug tracking-[-0.01em] text-fg-1',
            note.status === 'DONE' && 'line-through',
          )}
        >
          {note.title || 'Ohne Titel'}
        </span>
        <div className="flex items-center gap-2.5">
          <span className={cn('text-11 tabular-nums whitespace-nowrap', dueToneClass[due.tone])} style={{ fontWeight: due.weight }}>
            {due.label}
          </span>
          {checklistLabel && <span className="text-11 font-medium text-fg-muted tabular-nums">{checklistLabel}</span>}
          <span className="flex-1" />
          {showPriorityDot && (
            <span
              role="img"
              aria-label={`Priorität: ${PRIORITY_LABELS[note.priority]}`}
              className={cn('h-[7px] w-[7px] shrink-0 rounded-full', priorityToneClass[note.priority])}
            />
          )}
          {showAssignee && note.assignee && (
            <span
              title={note.assignee.displayName ?? note.assignee.email}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground"
            >
              {initialsOf(note.assignee.displayName ?? note.assignee.email)}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}
