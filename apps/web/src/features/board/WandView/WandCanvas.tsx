import { useDroppable } from '@dnd-kit/core';
import { useRef, type MouseEvent } from 'react';
import {
  FREE_CANVAS_HEIGHT,
  FREE_CANVAS_WIDTH,
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  type NoteDto,
} from '@wally/shared';
import { NoteCard } from './NoteCard';

export const FREE_CANVAS_DROPPABLE_ID = 'free-canvas';

interface WandCanvasProps {
  notes: NoteDto[];
  currentUserId: string | undefined;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  onCreateAt: (x: number, y: number) => void;
  canEdit: boolean;
}

/**
 * Frei mode's canvas: a fixed FREE_CANVAS_WIDTH x FREE_CANVAS_HEIGHT absolute-pixel area
 * (not percentage-based, so positions survive window resizes — see constants.ts) that
 * notes are placed on via {freeX, freeY}. One useDroppable region covers the whole
 * canvas; WandView's onDragEnd computes the new position from the drag delta.
 */
export function WandCanvas({ notes, currentUserId, selectedNoteId, onOpenNote, onCreateAt, canEdit }: WandCanvasProps) {
  const { setNodeRef, isOver } = useDroppable({ id: FREE_CANVAS_DROPPABLE_ID });
  const scrollRef = useRef<HTMLDivElement>(null);

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
    <div ref={scrollRef} className="wally-scroll h-full min-w-0 flex-1 overflow-auto" onDoubleClick={handleDoubleClick}>
      <div
        ref={setNodeRef}
        className="relative"
        style={{
          width: FREE_CANVAS_WIDTH,
          height: FREE_CANVAS_HEIGHT,
          background: isOver ? 'rgba(253,111,82,0.03)' : undefined,
        }}
      >
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            currentUserId={currentUserId}
            selected={selectedNoteId === note.id}
            onOpen={() => onOpenNote(note.id)}
            style={{ position: 'absolute', left: note.freeX, top: note.freeY }}
          />
        ))}
        {notes.length === 0 && (
          <p className="absolute left-1/2 top-[38%] -translate-x-1/2 text-13 text-fg-muted">
            Keine Notiz passt zum Filter. Doppelklick legt eine neue an.
          </p>
        )}
      </div>
    </div>
  );
}
