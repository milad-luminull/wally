import { useMemo } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  FREE_CANVAS_HEIGHT,
  FREE_CANVAS_WIDTH,
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  type NoteDto,
  type NoteHorizon,
  type NotePriority,
} from '@wally/shared';
import type { BoardAxis } from '../hooks/useBoardViewState';
import { useMoveNote } from '../hooks/mutations/useMoveNote';
import { useCreateNote } from '../hooks/mutations/useCreateNote';
import { groupByAxis } from '../util/noteDerived';
import { ZoneBands, zoneDroppableId } from './ZoneBands';
import { WandCanvas, FREE_CANVAS_DROPPABLE_ID } from './WandCanvas';

interface WandViewProps {
  boardId: string;
  notes: NoteDto[];
  currentUserId: string | undefined;
  axis: BoardAxis;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  canEdit: boolean;
}

function findNote(notes: NoteDto[], id: string): NoteDto | undefined {
  return notes.find((n) => n.id === id);
}

function noteLabel(note: NoteDto | undefined): string {
  return note?.title || 'Notiz ohne Titel';
}

/** Wraps ZoneBands (Horizon/Priority) or WandCanvas (Frei) in a single DndContext, so
 * dragging works identically regardless of axis — only the drop-target interpretation in
 * handleDragEnd differs. */
export function WandView({ boardId, notes, currentUserId, axis, selectedNoteId, onOpenNote, canEdit }: WandViewProps) {
  const moveNote = useMoveNote(boardId);
  const createNote = useCreateNote(boardId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const groups = useMemo(
    () => (axis === 'free' ? [] : groupByAxis(notes, axis)),
    [notes, axis],
  );

  const announcements: Announcements = {
    onDragStart({ active }) {
      return `${noteLabel(findNote(notes, String(active.id)))} wird verschoben.`;
    },
    onDragOver({ active, over }) {
      if (!over) return `${noteLabel(findNote(notes, String(active.id)))} ist über keinem Ziel.`;
      return `${noteLabel(findNote(notes, String(active.id)))} ist über einem Ablagebereich.`;
    },
    onDragEnd({ active, over }) {
      if (!over) return `${noteLabel(findNote(notes, String(active.id)))} wurde nicht verschoben.`;
      return `${noteLabel(findNote(notes, String(active.id)))} wurde verschoben.`;
    },
    onDragCancel({ active }) {
      return `Verschieben von ${noteLabel(findNote(notes, String(active.id)))} abgebrochen.`;
    },
  };

  function handleDragEnd(event: DragEndEvent) {
    if (!canEdit) return;
    const { active, over } = event;
    if (!over) return;
    const noteId = String(active.id);
    const note = findNote(notes, noteId);
    if (!note) return;
    const overId = String(over.id);

    if (overId === FREE_CANVAS_DROPPABLE_ID) {
      const x = Math.max(0, Math.min(FREE_CANVAS_WIDTH - NOTE_CARD_WIDTH, note.freeX + event.delta.x));
      const y = Math.max(0, Math.min(FREE_CANVAS_HEIGHT - NOTE_CARD_HEIGHT, note.freeY + event.delta.y));
      moveNote.mutate({ noteId, input: { mode: 'FREE', x, y } });
      return;
    }

    if (overId.startsWith('zone:horizon:')) {
      const horizon = overId.slice('zone:horizon:'.length) as NoteHorizon;
      if (horizon !== note.horizon) moveNote.mutate({ noteId, input: { mode: 'HORIZON', horizon } });
      return;
    }

    if (overId.startsWith('zone:priority:')) {
      const priority = overId.slice('zone:priority:'.length) as NotePriority;
      if (priority !== note.priority) moveNote.mutate({ noteId, input: { mode: 'PRIORITY', priority } });
    }
  }

  function handleCreateInZone(key: string) {
    if (axis === 'horizon') createNote.mutate({ horizon: key as NoteHorizon }, { onSuccess: (n) => onOpenNote(n.id) });
    else if (axis === 'priority') createNote.mutate({ priority: key as NotePriority }, { onSuccess: (n) => onOpenNote(n.id) });
  }

  function handleCreateAt(x: number, y: number) {
    createNote.mutate({ freeX: x, freeY: y }, { onSuccess: (n) => onOpenNote(n.id) });
  }

  return (
    <DndContext sensors={sensors} accessibility={{ announcements }} onDragEnd={handleDragEnd}>
      {axis === 'free' ? (
        <WandCanvas
          notes={notes}
          currentUserId={currentUserId}
          selectedNoteId={selectedNoteId}
          onOpenNote={onOpenNote}
          onCreateAt={handleCreateAt}
          canEdit={canEdit}
        />
      ) : (
        <ZoneBands
          axis={axis}
          groups={groups}
          currentUserId={currentUserId}
          selectedNoteId={selectedNoteId}
          onOpenNote={onOpenNote}
          onCreateInZone={handleCreateInZone}
          canEdit={canEdit}
        />
      )}
    </DndContext>
  );
}

// Re-exported for tests / other callers that need the id convention without importing
// the internal band component directly.
export { zoneDroppableId };
