import { useDraggable } from '@dnd-kit/core';
import { CheckCircle2, ListChecks, Plus } from 'lucide-react';
import { useContext, type CSSProperties, type ReactNode } from 'react';
import type { NoteDto } from '@wally/shared';
import { useTranslation } from 'react-i18next';
import { useEnumLabels } from '@/i18n/enumLabels';
import { cn } from '@/lib/cn';
import { dueInfo, dueToneClass, noteColourFillClass, subtaskCountLabel } from '../util/noteDerived';
import { PriorityIcon } from '../PriorityIcon';
import { AssigneeAvatar } from '../AssigneeAvatar';
import { PrivateBadge } from '../PrivateBadge';
import { CopyDragContext } from './copyDrag';

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
  const description = note.description.trim();
  const isDone = note.status === 'DONE';
  const copying = useContext(CopyDragContext);

  const body = (
    <>
      <span
        className={cn(
          'line-clamp-3 text-14 font-medium leading-snug text-fg-1',
          isDone && 'line-through decoration-fg-faint',
        )}
      >
        {note.title || t('common.untitled')}
      </span>

      {description && (
        <span className="-mt-1 line-clamp-1 text-12 leading-snug text-fg-meta-on-note">
          {description}
        </span>
      )}

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
          <PriorityIcon
            priority={note.priority}
            label={t('board.priorityPrefix', { label: priorityLabels[note.priority] })}
          />
        )}

        {note.visibility === 'PRIVATE' ? (
          <PrivateBadge className="text-fg-meta-on-note" />
        ) : (
          note.assignee && (
            <AssigneeAvatar user={note.assignee} isYou={note.assignee.id === currentUserId} />
          )
        )}
      </div>
    </>
  );

  const surface =
    'relative flex w-[248px] select-none flex-col gap-2 overflow-hidden rounded-lg border p-3 text-left';

  if (overlay) {
    return (
      // Deliberately not `data-note-id`: that selector addresses cards on the board, and
      // during a drag the overlay would otherwise be a second element with the same id.
      <div data-note-overlay={note.id} aria-hidden className="relative">
        {copying && (
          <span className="absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-e2">
            <Plus className="h-3 w-3" strokeWidth={2.5} />
          </span>
        )}
        <div
          className={cn(
            surface,
            noteColourFillClass[note.colour],
            // Lifted off the board and tilted a hair, so the card reads as picked up.
            // Kept subtle: this is unwound on release, and a big tilt has further to fall.
            'border-[color:var(--note-border)] shadow-e3 rotate-[1.5deg] scale-[1.03]',
            copying ? 'cursor-copy' : 'cursor-grabbing',
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
      dragging={dragging && !copying}
      copying={copying}
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
  copying: boolean;
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
  copying,
  onOpen,
  style,
  surface,
  body,
}: RestingProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: note.id });
  // A copy-drag leaves the original in place: only the copy is travelling.
  const hidden = dragging || (isDragging && !copying);

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
          // Keyboard focus is an outline, so it never fights the selection ring below.
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring-alpha)]',
          noteColourFillClass[note.colour],
          // Selection is a 2px ink ring drawn INSIDE the card — no fill, no tint, so the note
          // keeps its own colour (docs/BRAND.md). Inset, because the zones are scroll
          // containers: an outline outside the card was clipped along the column's top edge.
          selected
            ? 'border-transparent shadow-e2 ring-2 ring-inset ring-[color:var(--note-selected)]'
            : 'border-[color:var(--note-border)] shadow-pin',
          // The overlay copy is what follows the cursor, so the source is hidden outright
          // rather than left behind as a ghost. `invisible` keeps its slot, so the column
          // does not reflow under the cursor mid-drag.
          hidden
            ? 'invisible'
            : 'hover:-translate-y-0.5 hover:shadow-e2 motion-reduce:hover:translate-y-0',
          isDone && 'opacity-55 saturate-50',
        )}
      >
        {body}
      </button>
    </div>
  );
}
