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
  type NoteVisibility,
  type SuggestionFieldKey,
} from '@wally/shared';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/ui/empty-state';
import { useCanvasPattern } from '@/lib/preferences';
import { InlineCaptureCard } from '../Capture/InlineCaptureCard';
import type { CaptureAsk, CapturePlacement } from '../Capture/useCapture';
import { askCardOrigin, type AskSlot } from '../Ask/askSlot';
import type { PendingProps } from '../Suggestions/pendingProps';
import { NoteCard } from './NoteCard';

export const FREE_CANVAS_DROPPABLE_ID = 'free-canvas';

interface WallCanvasProps {
  boardId: string;
  notes: NoteDto[];
  currentUserId: string | undefined;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  /** A double-click on empty canvas asks for a new note written at that point. */
  onCapture: (placement: CapturePlacement) => void;
  /** The note being written, shown on the canvas when its placement is free. */
  capture: CapturePlacement | null;
  /** Changes with every capture, so each one gets a fresh card. */
  captureKey?: number;
  onCaptureDone: (noteId: string | null, open: boolean, locked: SuggestionFieldKey[]) => void;
  /** Hears each id the note being written is shown under, so the board leaves it to its card. */
  onCaptureNoteId?: (noteId: string) => void;
  /** Hears a question typed into the card; absent when the board's assistant is off. */
  onCaptureAsk?: CaptureAsk;
  /** The answer to a question, shown on the canvas when its placement is free (§3.6). */
  ask?: AskSlot | null;
  /** What a new note's visibility will be; a viewer's is private. */
  visibility: NoteVisibility;
  /** Only picks the empty-state copy; anyone may add a note, and a viewer's is private. */
  canEditShared: boolean;
  /** True when the board has notes but the active filter hides all of them. */
  filtered: boolean;
  activeDragId: string | null;
  /** The pending Wallybot change each note shows, if any (WALLYBOT_INLINE.md §3.3). */
  pendingFor?: (noteId: string) => PendingProps | undefined;
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
  boardId,
  notes,
  currentUserId,
  selectedNoteId,
  onOpenNote,
  onCapture,
  capture,
  captureKey,
  onCaptureDone,
  onCaptureNoteId,
  onCaptureAsk,
  ask,
  visibility,
  canEditShared,
  filtered,
  activeDragId,
  pendingFor,
  relatedCounts,
}: WallCanvasProps) {
  const { t } = useTranslation();
  const { setNodeRef } = useDroppable({ id: FREE_CANVAS_DROPPABLE_ID });
  const scrollRef = useRef<HTMLDivElement>(null);
  const keys = emptyStateKeys(filtered, canEditShared);
  const [pattern] = useCanvasPattern();

  function handleDoubleClick(e: MouseEvent<HTMLDivElement>) {
    // A double-click on a card, on the note being written (selecting a word) or on an answer
    // is not a request for another note.
    if ((e.target as HTMLElement).closest('[data-note-id], [data-capture], [data-ask]')) return;
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
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              currentUserId={currentUserId}
              selected={selectedNoteId === note.id}
              dragging={activeDragId === note.id}
              onOpen={() => onOpenNote(note.id)}
              pending={pendingFor?.(note.id)}
              relatedCount={relatedCounts?.get(note.id)}
              style={{ position: 'absolute', left: note.freeX, top: note.freeY }}
            />
          ))}
          {capture?.kind === 'free' && (
            <div
              key={captureKey}
              data-capture
              // Above an answer card at the same point (31 over 30): a note started from New
              // note may land where the answer stands, and the card being written comes first.
              style={{ position: 'absolute', left: capture.x, top: capture.y, zIndex: 31 }}
            >
              <InlineCaptureCard
                boardId={boardId}
                placement={capture}
                visibility={visibility}
                layout="card"
                onDone={onCaptureDone}
                onNoteId={onCaptureNoteId}
                onAsk={onCaptureAsk}
              />
            </div>
          )}
          {ask?.placement.kind === 'free' && (
            <div
              key={ask.key}
              data-ask
              style={{
                position: 'absolute',
                // Clamped like a capture point, for the answer's own size.
                left: askCardOrigin(ask.placement).x,
                top: askCardOrigin(ask.placement).y,
                zIndex: 30,
              }}
            >
              {ask.card}
            </div>
          )}
        </div>
      </div>

      {/* Sits outside the scroll container so the prompt stays centred in the visible
          panel instead of drifting off with the 2400px canvas. `pointer-events-none` keeps
          the double-click-to-create gesture working straight through it. */}
      {notes.length === 0 && !capture && !ask && (
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
