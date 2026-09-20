import { useDroppable } from '@dnd-kit/core';
import { useRef, type MouseEvent } from 'react';
import { MousePointerClick } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  FREE_CANVAS_HEIGHT,
  FREE_CANVAS_WIDTH,
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  type NoteDto,
} from '@wally/shared';
import { cn } from '@/lib/cn';
import { NoteCard } from './NoteCard';

export const FREE_CANVAS_DROPPABLE_ID = 'free-canvas';

interface WandCanvasProps {
  notes: NoteDto[];
  currentUserId: string | undefined;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  onCreateAt: (x: number, y: number) => void;
  canEdit: boolean;
  /** True when the board has notes but the active filter hides all of them. */
  filtered: boolean;
  activeDragId: string | null;
}

/**
 * Frei mode's canvas: a fixed FREE_CANVAS_WIDTH x FREE_CANVAS_HEIGHT absolute-pixel area
 * (not percentage-based, so positions survive window resizes — see constants.ts) that
 * notes are placed on via {freeX, freeY}. One useDroppable region covers the whole
 * canvas; WandView's onDragEnd computes the new position from the drag delta.
 */
/** Keeps the empty-state branching out of JSX, and the keys literal so tsc checks them. */
function emptyStateKeys(filtered: boolean, canEdit: boolean) {
  if (filtered) {
    return { title: 'board.empty.filtered.title', body: 'board.empty.filtered.body' } as const;
  }
  return {
    title: 'board.empty.free.title',
    body: canEdit ? 'board.empty.free.canEdit' : 'board.empty.free.readOnly',
  } as const;
}

export function WandCanvas({
  notes,
  currentUserId,
  selectedNoteId,
  onOpenNote,
  onCreateAt,
  canEdit,
  filtered,
  activeDragId,
}: WandCanvasProps) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: FREE_CANVAS_DROPPABLE_ID });
  const scrollRef = useRef<HTMLDivElement>(null);
  const keys = emptyStateKeys(filtered, canEdit);

  function handleDoubleClick(e: MouseEvent<HTMLDivElement>) {
    if (!canEdit) return;
    if ((e.target as HTMLElement).closest('[data-note-id]')) return;
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rawX = e.clientX - rect.left + el.scrollLeft;
    const rawY = e.clientY - rect.top + el.scrollTop;
    const x = Math.max(0, Math.min(FREE_CANVAS_WIDTH - NOTE_CARD_WIDTH, rawX));
    const y = Math.max(0, Math.min(FREE_CANVAS_HEIGHT - NOTE_CARD_HEIGHT, rawY));
    onCreateAt(x, y);
  }

  return (
    <div className="relative h-full min-w-0 flex-1">
      <div ref={scrollRef} className="wally-scroll h-full w-full overflow-auto" onDoubleClick={handleDoubleClick}>
        <div
          ref={setNodeRef}
          className={cn(
            'board-surface relative transition-[background-color] duration-200 ease-ds',
            isOver && 'bg-[color:var(--zone-surface-over)]',
          )}
          style={{ width: FREE_CANVAS_WIDTH, height: FREE_CANVAS_HEIGHT }}
        >
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              currentUserId={currentUserId}
              selected={selectedNoteId === note.id}
              dragging={activeDragId === note.id}
              onOpen={() => onOpenNote(note.id)}
              style={{ position: 'absolute', left: note.freeX, top: note.freeY }}
            />
          ))}
        </div>
      </div>

      {/* Sits outside the scroll container so the prompt stays centred in the visible
          panel instead of drifting off with the 2400px canvas. `pointer-events-none` keeps
          the double-click-to-create gesture working straight through it. */}
      {notes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="flex max-w-xs flex-col items-center gap-2 rounded-2xl border border-dashed border-border-strong bg-[color:var(--zone-surface)] px-7 py-8 text-center backdrop-blur-[1px]">
            <MousePointerClick className="h-5 w-5 text-fg-faint" strokeWidth={1.7} />
            <p className="font-head text-15 font-semibold text-fg-1">{t(keys.title)}</p>
            <p className="text-12 text-fg-muted">{t(keys.body)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
