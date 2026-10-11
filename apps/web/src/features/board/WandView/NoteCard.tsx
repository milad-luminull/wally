import { useDraggable } from '@dnd-kit/core';
import { CheckCircle2, ListChecks } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { NoteDto } from '@wally/shared';
import { useTranslation } from 'react-i18next';
import { useEnumLabels } from '@/i18n/enumLabels';
import { cn } from '@/lib/cn';
import {
  dueInfo,
  dueToneClass,
  initialsOf,
  noteColourFillClass,
  subtaskCountLabel,
} from '../util/noteDerived';
import { PriorityDot } from '../PriorityDot';

interface NoteCardProps {
  note: NoteDto;
  currentUserId: string | undefined;
  selected: boolean;
  onOpen: () => void;
  style?: CSSProperties;
  /**
   * Render as the floating copy inside dnd-kit's `<DragOverlay>` rather than as a card
   * resting on the board. The overlay is the element dnd-kit translates, so this variant
   * registers no draggable and carries no animation of its own.
   */
  overlay?: boolean;
  /**
   * True while this note is the one being dragged. Comes from the board rather than
   * dnd-kit's own `isDragging`: dnd-kit clears that the instant the pointer is released,
   * in its own render pass, which un-hid the card a frame before the reposition landed.
   * The board clears this in the same commit that writes the new position.
   */
  dragging?: boolean;
}

/**
 * A note card.
 *
 * Movement during a drag belongs to `<DragOverlay>` (see WandView), not to this component,
 * for two reasons: the board's zones are scroll containers, so a card translated in place
 * gets clipped the moment it crosses a column edge; and a note moving between zones is
 * re-parented, so React unmounts and remounts it — any mount-triggered animation here
 * would replay on every move.
 */
export function NoteCard({
  note,
  currentUserId,
  selected,
  onOpen,
  style,
  overlay = false,
  dragging = false,
}: NoteCardProps) {
  const { t } = useTranslation();
  const { priority: priorityLabels } = useEnumLabels();
  const due = dueInfo(note, t);
  const checklistLabel = subtaskCountLabel(note.subtaskSummary);
  const showAssignee = note.assignee && note.assignee.id !== currentUserId;
  const isDone = note.status === 'DONE';

  const body = (
    <>
      <span
        className={cn(
          'line-clamp-3 text-14 font-semibold leading-snug text-fg-1',
          isDone && 'line-through decoration-fg-faint',
        )}
      >
        {note.title || 'Ohne Titel'}
      </span>

      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex items-center gap-1 whitespace-nowrap text-12 tabular-nums',
            dueToneClass[due.tone],
          )}
          style={{ fontWeight: due.weight }}
        >
          {isDone && <CheckCircle2 className="h-3 w-3 shrink-0" strokeWidth={2.2} />}
          {due.label}
        </span>

        {checklistLabel && (
          <span className="flex items-center gap-1 text-12 font-medium tabular-nums text-fg-meta-on-note">
            <ListChecks className="h-3 w-3 shrink-0" strokeWidth={1.9} />
            {checklistLabel}
          </span>
        )}

        <span className="flex-1" />

        {!isDone && (
          <PriorityDot
            priority={note.priority}
            label={t('board.priorityPrefix', { label: priorityLabels[note.priority] })}
          />
        )}

        {showAssignee && note.assignee && (
          <span
            title={note.assignee.displayName ?? note.assignee.email}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-12 font-semibold text-primary-foreground"
          >
            {initialsOf(note.assignee.displayName ?? note.assignee.email)}
          </span>
        )}
      </div>
    </>
  );

  const surface =
    'relative flex w-[248px] select-none flex-col gap-2.5 overflow-hidden rounded-xl border p-3.5 text-left';

  if (overlay) {
    return (
      // Deliberately not `data-note-id`: that selector addresses cards on the board, and
      // during a drag the overlay would otherwise be a second element with the same id.
      <div data-note-overlay={note.id} aria-hidden>
        <div
          className={cn(
            surface,
            noteColourFillClass[note.colour],
            // Lifted off the board and tilted a hair, so the card reads as picked up.
            // Kept subtle: this is unwound on release, and a big tilt has further to fall.
            'cursor-grabbing border-border-subtle shadow-e3 rotate-[1.2deg] scale-[1.02]',
            isDone && 'opacity-60 saturate-50',
          )}
        >
          {body}
        </div>
      </div>
    );
  }

  return (
    <RestingNoteCard
      note={note}
      selected={selected}
      isDone={isDone}
      dragging={dragging}
      onOpen={onOpen}
      style={style}
      surface={surface}
      body={body}
    />
  );
}

interface RestingProps {
  note: NoteDto;
  selected: boolean;
  isDone: boolean;
  dragging: boolean;
  onOpen: () => void;
  style?: CSSProperties;
  surface: string;
  body: ReactNode;
}

/** Split out so the overlay variant above never calls `useDraggable`. */
function RestingNoteCard({
  note,
  selected,
  isDone,
  dragging,
  onOpen,
  style,
  surface,
  body,
}: RestingProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: note.id });
  const hidden = dragging || isDragging;

  const wrapperStyle: CSSProperties = {
    ...style,
    zIndex: selected ? 20 : style?.zIndex,
  };

  return (
    <div
      ref={setNodeRef}
      style={wrapperStyle}
      data-note-id={note.id}
      data-dragging={hidden || undefined}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        onClick={onOpen}
        className={cn(
          surface,
          'group/note cursor-grab',
          // Hover/press easing only — never a transition on `opacity`, so picking a card
          // up hides it on the same frame the overlay appears instead of cross-fading.
          'transition-[transform,box-shadow,border-color] duration-150 ease-ds',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
          noteColourFillClass[note.colour],
          // Selection is a 2px slate outline and nothing else — no fill, no tint, so the
          // note keeps its own colour underneath (docs/BRAND.md). `outline` rather than a
          // border so the card's box does not shift by a pixel when it is selected.
          'outline-offset-0',
          selected
            ? 'border-transparent shadow-e2 outline outline-2 outline-[color:var(--note-selected)]'
            : 'border-border-subtle shadow-pin',
          // The overlay copy is what follows the cursor, so the source is hidden outright
          // rather than left behind as a ghost. `invisible` keeps its slot, so the column
          // does not reflow under the cursor mid-drag.
          hidden
            ? 'invisible'
            : 'hover:-translate-y-0.5 hover:shadow-e2 motion-reduce:hover:translate-y-0',
          isDone && 'opacity-60 saturate-50',
        )}
      >
        {body}
      </button>
    </div>
  );
}
