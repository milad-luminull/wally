import { useEffect, useMemo, useRef, useState } from 'react';
import type { DuplicatePlacement } from '../hooks/mutations/useDuplicateNote';
import { useTranslation } from 'react-i18next';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  FREE_CANVAS_HEIGHT,
  FREE_CANVAS_WIDTH,
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  type NoteDto,
  type NoteHorizon,
  type NotePriority,
  type NoteVisibility,
  type SuggestionFieldKey,
} from '@wally/shared';
import type { BoardAxis } from '../hooks/useBoardViewState';
import type { BoardAccess } from '../util/permissions';
import type { T } from '@/i18n/enumLabels';
import { noteMovePatch, useMoveNote } from '../hooks/mutations/useMoveNote';
import { nextFreeNotePosition } from '../util/notePlacement';
import {
  cancelNoteCaches,
  patchNoteCaches as writeNoteCaches,
  restoreNoteCaches,
  snapshotNoteCaches,
  type NoteCacheSnapshot,
} from '../hooks/mutations/shared';
import { groupByAxis } from '../util/noteDerived';
import type { CapturePlacement } from '../Capture/useCapture';
import type { PendingProps } from '../Suggestions/pendingProps';
import { ZoneBands, zoneDroppableId } from './ZoneBands';
import { WandCanvas, FREE_CANVAS_DROPPABLE_ID } from './WandCanvas';
import { NoteCard } from './NoteCard';
import { CopyDragContext } from './copyDrag';
import { useQueryKeys } from '../hooks/queryKeys';

interface WandViewProps {
  boardId: string;
  notes: NoteDto[];
  /** Notes on the board before filtering — distinguishes "empty board" from "filter hides
   * everything" in the empty-state copy. */
  totalNoteCount: number;
  currentUserId: string | undefined;
  axis: BoardAxis;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  /** Places a copy of a note — what an Alt/Option-drag drops instead of moving it. */
  onDuplicateNote: (noteId: string, placement: DuplicatePlacement) => void;
  access: BoardAccess;
  /** The note being written in place, if any (WALLYBOT_INLINE.md §3.1). */
  capture: CapturePlacement | null;
  /** Changes with every capture, so each one gets a fresh card. */
  captureKey?: number;
  /** A zone's plus or a double-click asks for a new note written there. */
  onCapture: (placement: CapturePlacement) => void;
  onCaptureDone: (noteId: string | null, open: boolean, locked: SuggestionFieldKey[]) => void;
  /** Hears each id the note being written is shown under, so the board leaves it to its card. */
  onCaptureNoteId?: (noteId: string) => void;
  /** What a new note's visibility will be; a viewer's is private. */
  visibility: NoteVisibility;
  /** The pending Wallybot change each note shows, if any (WALLYBOT_INLINE.md §3.3). */
  pendingFor?: (noteId: string) => PendingProps | undefined;
}

function findNote(notes: NoteDto[], id: string): NoteDto | undefined {
  return notes.find((n) => n.id === id);
}

function noteLabel(note: NoteDto | undefined, t: T): string {
  return note?.title || t('board.dnd.untitled');
}

/** Wraps ZoneBands (Horizon/Priority) or WandCanvas (Frei) in a single DndContext, so
 * dragging works identically regardless of axis — only the drop-target interpretation in
 * handleDragEnd differs. */
export function WandView({
  boardId,
  notes,
  totalNoteCount,
  currentUserId,
  axis,
  selectedNoteId,
  onOpenNote,
  onDuplicateNote,
  access,
  capture,
  captureKey,
  onCapture,
  onCaptureDone,
  onCaptureNoteId,
  visibility,
  pendingFor,
}: WandViewProps) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const { t } = useTranslation();
  const moveNote = useMoveNote(boardId);

  /** The note currently under the cursor, rendered into `<DragOverlay>`. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeNote = activeId ? findNote(notes, activeId) : undefined;

  /**
   * Cache state as it was when this drag began. The board relocates the note optimistically
   * while the pointer is still down, so this is what a failed request (or a cancelled drag)
   * has to roll back to.
   */
  const dragRollback = useRef<{ noteId: string; snapshot: NoteCacheSnapshot } | null>(null);

  /**
   * Alt/Option held during the drag: the drop places a copy and the original stays put.
   * Followed live rather than read once at pick-up, so the key can be pressed or let go
   * mid-drag the way it works in design tools. The ref is for the dnd-kit callbacks, which
   * can run before the state update renders.
   */
  const [copyDrag, setCopyDrag] = useState(false);
  const copyDragRef = useRef(false);
  function setCopying(value: boolean) {
    copyDragRef.current = value;
    setCopyDrag(value);
  }

  useEffect(() => {
    if (!activeId) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Alt') return;
      // Alone, Alt focuses the menu bar on Windows — not while it means "copy".
      event.preventDefault();
      setCopying(event.type === 'keydown');
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [activeId]);

  /**
   * The just-dropped move, held in React state so the board can paint it in the very frame
   * the pointer is released.
   *
   * The query cache is the real source of truth, but writing to it only schedules a render:
   * React Query notifies on a microtask and React's scheduler then decides when to commit.
   * Meanwhile dnd-kit removes the drag overlay immediately on release. Any delay between
   * those two therefore shows either the note back at its old position or, if it is kept
   * hidden to avoid that, nothing at all — measured at over 100ms once the scheduler was
   * under load. Overriding locally lets `flushSync` put the note in its new home and reveal
   * it in one synchronous commit, before the browser can paint the gap. It is dropped again
   * as soon as the cache catches up.
   */
  const [pendingMove, setPendingMove] = useState<{
    noteId: string;
    patch: Partial<NoteDto>;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const shownNotes = useMemo(() => {
    if (!pendingMove) return notes;
    return notes.map((n) => (n.id === pendingMove.noteId ? { ...n, ...pendingMove.patch } : n));
  }, [notes, pendingMove]);

  // Let go of the override once the cache reports the same thing, so there is only ever one
  // source of truth for longer than a moment. A rolled-back failure clears it too, because
  // the entry then no longer matches and the effect below stops re-applying it.
  useEffect(() => {
    if (!pendingMove) return;
    const note = findNote(notes, pendingMove.noteId);
    if (!note) {
      setPendingMove(null);
      return;
    }
    const settled = (Object.keys(pendingMove.patch) as (keyof NoteDto)[]).every(
      (k) => note[k] === pendingMove.patch[k],
    );
    if (settled) setPendingMove(null);
  }, [notes, pendingMove]);

  // `t` belongs in these deps — see the note on ListView's identical memo.
  const groups = useMemo(
    () => (axis === 'free' ? [] : groupByAxis(shownNotes, axis, t)),
    [shownNotes, axis, t],
  );

  const announcements: Announcements = {
    onDragStart({ active }) {
      return t('board.dnd.picked', { note: noteLabel(findNote(notes, String(active.id)), t) });
    },
    onDragOver({ active, over }) {
      const note = noteLabel(findNote(notes, String(active.id)), t);
      return t(over ? 'board.dnd.overZone' : 'board.dnd.overNothing', { note });
    },
    onDragEnd({ active, over }) {
      const note = noteLabel(findNote(notes, String(active.id)), t);
      if (!over) return t('board.dnd.notMoved', { note });
      return t(copyDragRef.current ? 'board.dnd.copied' : 'board.dnd.moved', { note });
    },
    onDragCancel({ active }) {
      return t('board.dnd.cancelled', { note: noteLabel(findNote(notes, String(active.id)), t) });
    },
  };

  /** Maps a droppable id to the zone it stands for, or null if it is not a zone. */
  function zoneFor(overId: string) {
    if (overId.startsWith('zone:horizon:')) {
      return { horizon: overId.slice('zone:horizon:'.length) as NoteHorizon };
    }
    if (overId.startsWith('zone:priority:')) {
      return { priority: overId.slice('zone:priority:'.length) as NotePriority };
    }
    return null;
  }

  /** Maps a droppable id to the move it represents, or null if it is not a zone. */
  function zoneMoveFor(overId: string, note: NoteDto) {
    const zone = zoneFor(overId);
    if (zone?.horizon) {
      return zone.horizon === note.horizon
        ? null
        : ({ mode: 'HORIZON', horizon: zone.horizon } as const);
    }
    if (zone?.priority) {
      return zone.priority === note.priority
        ? null
        : ({ mode: 'PRIORITY', priority: zone.priority } as const);
    }
    return null;
  }

  /** Free-canvas drop position: where the card was picked up, plus how far it travelled. */
  function freeDropPosition(event: DragEndEvent, origin: NoteDto) {
    return {
      x: Math.max(0, Math.min(FREE_CANVAS_WIDTH - NOTE_CARD_WIDTH, origin.freeX + event.delta.x)),
      y: Math.max(0, Math.min(FREE_CANVAS_HEIGHT - NOTE_CARD_HEIGHT, origin.freeY + event.delta.y)),
    };
  }

  function handleDragStart(event: DragStartEvent) {
    const noteId = String(event.active.id);
    setActiveId(noteId);
    setCopying(Boolean((event.activatorEvent as KeyboardEvent | PointerEvent | null)?.altKey));
    dragRollback.current = {
      noteId,
      snapshot: snapshotNoteCaches(queryClient, keys, boardId, noteId),
    };
    // Nothing in flight may land on top of the live repositioning below.
    cancelNoteCaches(queryClient, keys, boardId, noteId);
  }

  function commitMove(noteId: string, patch: Parameters<typeof writeNoteCaches>[4]) {
    writeNoteCaches(queryClient, keys, boardId, noteId, patch);
  }

  function endDrag() {
    setActiveId(null);
    setCopying(false);
    dragRollback.current = null;
  }

  function cancelPendingMove() {
    setPendingMove(null);
  }

  /** Where the lifted card sits at the moment of release, in viewport coordinates. */
  function overlayRect(): DOMRect | null {
    return (
      document.querySelector('[data-note-overlay]')?.parentElement?.getBoundingClientRect() ?? null
    );
  }

  /**
   * Lands the drop in a single synchronous commit, then plays the card in from the cursor.
   *
   * `flushSync` is what makes this safe: applying the local override and clearing the drag
   * together means the note is painted in its new home, visible, in the same frame dnd-kit
   * removes the overlay. There is no window in which the two disagree, so neither the old
   * position nor an empty gap can ever be shown — regardless of how busy React's scheduler
   * is. The card is then already laid out, so the travel can be measured and started right
   * here instead of waiting for a later effect.
   */
  function settleCard(noteId: string, patch: Partial<NoteDto>, releaseRect: DOMRect | null) {
    flushSync(() => {
      setPendingMove({ noteId, patch });
      endDrag();
    });

    const el = document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(noteId)}"]`);
    if (!el || !releaseRect || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;

    const landed = el.getBoundingClientRect();
    const dx = releaseRect.left - landed.left;
    const dy = releaseRect.top - landed.top;
    // Free-canvas drops land under the cursor, so there is usually nothing to travel.
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(1.2deg) scale(1.02)`, zIndex: '30' },
        { transform: 'translate(0, 0) rotate(0deg) scale(1)', zIndex: '30' },
      ],
      { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
    );
  }

  /** Restores the pre-drag cache state. Reads the note id out of the ref rather than
   *  `activeId`, so it cannot miss the rollback because of a stale closure. */
  function handleDragCancel() {
    const pending = dragRollback.current;
    if (pending) restoreNoteCaches(queryClient, keys, boardId, pending.noteId, pending.snapshot);
    cancelPendingMove();
    endDrag();
  }

  function handleDragEnd(event: DragEndEvent) {
    const rollback = dragRollback.current?.snapshot;
    const { active, over } = event;
    const noteId = String(active.id);
    const note = findNote(notes, noteId);

    if (!over || !note || !access.canEditNote(note)) {
      handleDragCancel();
      return;
    }

    const overId = String(over.id);
    const origin = rollback?.previousList?.find((n) => n.id === noteId) ?? note;

    if (copyDragRef.current) {
      // The original never moved, so there is nothing to commit for it — put the caches
      // back exactly as they were and let the copy appear where it was dropped. Dropping
      // into the note's own zone is a perfectly good copy, not a no-op.
      handleDragCancel();
      if (overId === FREE_CANVAS_DROPPABLE_ID) {
        const { x, y } = freeDropPosition(event, origin);
        onDuplicateNote(noteId, { freeX: x, freeY: y });
      } else {
        const zone = zoneFor(overId);
        if (zone) onDuplicateNote(noteId, zone);
      }
      return;
    }

    if (overId === FREE_CANVAS_DROPPABLE_ID) {
      // Free mode has no hover target to move into, so the position is only known now.
      // Patching before clearing `activeId` keeps both in the same commit, so the card is
      // never painted at its old coordinates after the overlay goes away.
      const { x, y } = freeDropPosition(event, origin);
      const released = overlayRect();
      commitMove(noteId, { freeX: x, freeY: y });
      moveNote.mutate({ noteId, input: { mode: 'FREE', x, y }, rollback });
      settleCard(noteId, { freeX: x, freeY: y }, released);
      return;
    }

    const move = zoneMoveFor(overId, note);
    if (!move) {
      endDrag();
      return;
    }

    // Apply the move before the overlay is released, so the card already occupies its new
    // slot when dnd-kit measures where to glide to.
    const released = overlayRect();
    const patch = noteMovePatch(move);
    commitMove(noteId, patch);
    moveNote.mutate({ noteId, input: move, rollback });
    settleCard(noteId, patch, released);
  }

  function handleCreateInZone(key: string) {
    if (axis === 'free') return;
    // The zone decides where the card shows in this axis, but freeX/freeY still has to be
    // something sensible: it is what Frei mode reads once the user switches over, and the
    // schema default of {0, 0} would stack every one of them in the corner there.
    onCapture({ kind: 'zone', axis, key, at: nextFreeNotePosition(notes) });
  }

  return (
    <CopyDragContext.Provider value={copyDrag}>
      <DndContext
        sensors={sensors}
        accessibility={{ announcements }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {axis === 'free' ? (
          <WandCanvas
            boardId={boardId}
            notes={shownNotes}
            filtered={totalNoteCount > 0}
            currentUserId={currentUserId}
            selectedNoteId={selectedNoteId}
            onOpenNote={onOpenNote}
            onCapture={onCapture}
            capture={capture}
            captureKey={captureKey}
            onCaptureDone={onCaptureDone}
            onCaptureNoteId={onCaptureNoteId}
            visibility={visibility}
            canEditShared={access.canEditShared}
            activeDragId={activeId}
            pendingFor={pendingFor}
          />
        ) : (
          <ZoneBands
            axis={axis}
            groups={groups}
            boardId={boardId}
            capture={capture}
            captureKey={captureKey}
            onCaptureDone={onCaptureDone}
            onCaptureNoteId={onCaptureNoteId}
            visibility={visibility}
            currentUserId={currentUserId}
            selectedNoteId={selectedNoteId}
            onOpenNote={onOpenNote}
            onCreateInZone={handleCreateInZone}
            activeDragId={activeId}
            filteredOut={shownNotes.length === 0 && totalNoteCount > 0}
            pendingFor={pendingFor}
          />
        )}

        {/* The dragged card lives here rather than in its column. Both the zone body and the
          board itself are scroll containers, so a card translated in place gets clipped at
          the column edge the moment it starts moving toward another zone.
          The overlay is removed on release without a dnd-kit drop animation: dnd-kit
          measures that animation before React can render the move, so it always aimed back
          at the zone the note came from. `settleCard` below does the travel instead. */}
        <DragOverlay dropAnimation={null}>
          {activeNote ? (
            <NoteCard
              note={activeNote}
              currentUserId={currentUserId}
              selected={false}
              onOpen={() => {}}
              overlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </CopyDragContext.Provider>
  );
}

// Re-exported for tests / other callers that need the id convention without importing
// the internal band component directly.
export { zoneDroppableId };
