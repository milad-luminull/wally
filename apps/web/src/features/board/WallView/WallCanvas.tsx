import { LinkLines } from './LinkLines';
import { useDroppable } from '@dnd-kit/core';
import { useRef, type MouseEvent } from 'react';
import { MousePointerClick } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  FREE_CANVAS_HEIGHT,
  FREE_CANVAS_WIDTH,
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  type CanvasPattern,
  type NoteDto,
} from '@wally/shared';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/ui/empty-state';
import { useCanvasPattern } from '@/lib/preferences';
import type { CapturePlacement } from '../WallyBox/placement';
import type { BoxSlot } from '../WallyBox/boxSlot';
import type { PendingProps } from '../Suggestions/pendingProps';
import { NoteCard } from './NoteCard';
import type { InlineEditProps } from '../Capture/inlineEdit';
import type { NoteCardActions } from './NoteCardActions';

export const FREE_CANVAS_DROPPABLE_ID = 'free-canvas';

/** The anchored box's width on the canvas; it is kept inside the canvas's right edge. */
export const ANCHORED_BOX_WIDTH = 400;

interface WallCanvasProps {
  notes: NoteDto[];
  currentUserId: string | undefined;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  cardActions?: (note: NoteDto) => NoteCardActions;
  /** A double-click on empty canvas opens the Wally box at that point. */
  onCapture: (placement: CapturePlacement) => void;
  /** The Wally box anchored on the canvas, drawn where its placement is free. */
  box?: BoxSlot | null;
  /** Only picks the empty-state copy; anyone may add a note, and a viewer's is private. */
  canEditShared: boolean;
  /** True when the board has notes but the active filter hides all of them. */
  filtered: boolean;
  activeDragId: string | null;
  /** The pending Wallybot change each note shows, if any (RFC-0005-wallybot-inline.md §3.3). */
  pendingFor?: (noteId: string) => PendingProps | undefined;
  /** Editing a note's words in place, for a note the person may edit. */
  editFor?: (note: NoteDto) => InlineEditProps | undefined;
  /** How many notes each note is related to, from the whole board (`relatedCounts`). */
  relatedCounts?: ReadonlyMap<string, number>;
}

/**
 * Free mode's canvas: a fixed FREE_CANVAS_WIDTH x FREE_CANVAS_HEIGHT absolute-pixel area
 * (not percentage-based, so positions survive window resizes — see constants.ts) that
 * notes are placed on via {freeX, freeY}. One useDroppable region covers the whole
 * canvas; WallView's onDragEnd computes the new position from the drag delta.
 */
/** Keeps the empty-state branching out of JSX, and the keys literal so tsc checks them. */
/* Literal class names, so Tailwind's content scan and the stylesheet agree on them. */
const CANVAS_PATTERN_CLASS: Record<CanvasPattern, string> = {
  dots: 'canvas-dots',
  grid: 'canvas-grid',
  none: 'canvas-none',
};

function emptyStateKeys(filtered: boolean, canEditShared: boolean) {
  if (filtered) {
    return { title: 'board.empty.filtered.title', body: 'board.empty.filtered.body' } as const;
  }
  return {
    title: 'board.empty.free.title',
    body: canEditShared ? 'board.empty.free.canEdit' : 'board.empty.free.viewer',
  } as const;
}

export function WallCanvas({
  notes,
  currentUserId,
  selectedNoteId,
  onOpenNote,
  cardActions,
  onCapture,
  box,
  canEditShared,
  filtered,
  activeDragId,
  pendingFor,
  editFor,
  relatedCounts,
}: WallCanvasProps) {
  const { t } = useTranslation();
  const { setNodeRef } = useDroppable({ id: FREE_CANVAS_DROPPABLE_ID });
  const scrollRef = useRef<HTMLDivElement>(null);
  const keys = emptyStateKeys(filtered, canEditShared);
  const [pattern] = useCanvasPattern();

  function handleDoubleClick(e: MouseEvent<HTMLDivElement>) {
    // A double-click on a card, or in the box (selecting a word), is not a request for a note.
    if ((e.target as HTMLElement).closest('[data-note-id], [data-wally-box]')) return;
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rawX = e.clientX - rect.left + el.scrollLeft;
    const rawY = e.clientY - rect.top + el.scrollTop;
    const x = Math.max(0, Math.min(FREE_CANVAS_WIDTH - NOTE_CARD_WIDTH, rawX));
    const y = Math.max(0, Math.min(FREE_CANVAS_HEIGHT - NOTE_CARD_HEIGHT, rawY));
    onCapture({ kind: 'free', x, y });
  }

  return (
    <div className="relative h-full min-w-0 flex-1">
      <div
        ref={scrollRef}
        data-testid="wall-canvas"
        className="wally-scroll h-full w-full overflow-auto"
        onDoubleClick={handleDoubleClick}
      >
        <div
          ref={setNodeRef}
          // No drop-target tint here: the whole canvas is the target, so any wash would just
          // recolour the entire background for the length of every drag.
          className={cn(CANVAS_PATTERN_CLASS[pattern], 'relative')}
          style={{ width: FREE_CANVAS_WIDTH, height: FREE_CANVAS_HEIGHT }}
        >
          <LinkLines notes={notes} pendingFor={pendingFor} />
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              currentUserId={currentUserId}
              selected={selectedNoteId === note.id}
              dragging={activeDragId === note.id}
              onOpen={() => onOpenNote(note.id)}
              actions={cardActions?.(note)}
              pending={pendingFor?.(note.id)}
              edit={editFor?.(note)}
              relatedCount={relatedCounts?.get(note.id)}
              style={{ position: 'absolute', left: note.freeX, top: note.freeY }}
            />
          ))}
          {box?.placement.kind === 'free' && (
            <div
              key={box.key}
              style={{
                position: 'absolute',
                // The note lands at the point; the box, wider than a note, stays on the canvas.
                left: Math.min(box.placement.x, FREE_CANVAS_WIDTH - ANCHORED_BOX_WIDTH),
                top: box.placement.y,
                width: ANCHORED_BOX_WIDTH,
                zIndex: 31,
              }}
            >
              {box.node}
            </div>
          )}
        </div>
      </div>

      {/* Sits outside the scroll container so the prompt stays centred in the visible
          panel instead of drifting off with the 2400px canvas. `pointer-events-none` keeps
          the double-click-to-create gesture working straight through it. */}
      {notes.length === 0 && !box && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <EmptyState
            icon={<MousePointerClick strokeWidth={1.75} />}
            title={t(keys.title)}
            hint={t(keys.body)}
            className="rounded-xl border border-border bg-surface shadow-e2"
          />
        </div>
      )}
    </div>
  );
}
