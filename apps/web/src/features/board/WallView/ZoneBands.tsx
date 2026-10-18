import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NoteDto, NoteVisibility, SuggestionFieldKey } from '@wally/shared';
import { cn } from '@/lib/cn';
import type { BoardAxis } from '../hooks/useBoardViewState';
import type { NoteGroup } from '../util/noteDerived';
import { InlineCaptureCard } from '../Capture/InlineCaptureCard';
import type { CaptureAsk, CapturePlacement } from '../Capture/useCapture';
import type { AskSlot } from '../Ask/askSlot';
import type { PendingProps } from '../Suggestions/pendingProps';
import type { TidyProps } from '../Tidy/tidyProps';
import { NoteCard } from './NoteCard';

/** Droppable-region id convention consumed by WallView's onDragEnd. */
export function zoneDroppableId(axis: BoardAxis, key: string) {
  return `zone:${axis}:${key}`;
}

/** The note being written into one zone, and what the card needs to write it. */
interface ZoneCapture {
  key: number | undefined;
  boardId: string;
  placement: Extract<CapturePlacement, { kind: 'zone' }>;
  visibility: NoteVisibility;
  onDone: (noteId: string | null, open: boolean, locked: SuggestionFieldKey[]) => void;
  onNoteId: ((noteId: string) => void) | undefined;
  onAsk: CaptureAsk | undefined;
}

interface ZoneBandProps {
  axis: 'horizon' | 'priority';
  group: NoteGroup<string>;
  /** Set on the one zone a new note is being written into. */
  capture: ZoneCapture | null;
  /** Set on the one zone a question was written in: its answer, drawn at the top (§3.6). */
  ask: AskSlot | null;
  currentUserId: string | undefined;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  onCreateInZone: (key: string) => void;
  activeDragId: string | null;
  /** Every note on the board is hidden by the filters — say so, rather than "empty". */
  filteredOut: boolean;
  /** The pending Wallybot change each note shows, if any (WALLYBOT_INLINE.md §3.3). */
  pendingFor?: (noteId: string) => PendingProps | undefined;
  /** How many notes each note is related to, from the whole board (`relatedCounts`). */
  relatedCounts?: ReadonlyMap<string, number>;
  /** The note's part in a Tidy batch, if any (WALLYBOT_INLINE.md §3.5). */
  tidyFor?: (noteId: string) => TidyProps | undefined;
}

function ZoneBand({
  axis,
  group,
  capture,
  ask,
  currentUserId,
  selectedNoteId,
  onOpenNote,
  onCreateInZone,
  activeDragId,
  filteredOut,
  pendingFor,
  relatedCounts,
  tidyFor,
}: ZoneBandProps) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: zoneDroppableId(axis, group.key) });
  const isEmpty = group.notes.length === 0 && !capture && !ask;

  return (
    <section
      ref={setNodeRef}
      onDoubleClick={(e) => {
        // Selecting a word in the note being written, or in an answer, is not a request for
        // another note.
        if ((e.target as HTMLElement).closest('[data-capture], [data-ask]')) return;
        onCreateInZone(group.key);
      }}
      aria-label={t('board.zone.aria', { label: group.label, count: group.notes.length })}
      className={cn('paper-zone group/zone', isOver && 'paper-zone-over')}
    >
      <header className="paper-zone-header">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-fg-1">{group.label}</h2>
        {axis === 'priority' && (
          <span className="paper-zone-subtitle">
            {t(`board.zone.priorityHints.${group.key as 'HOCH' | 'MITTEL' | 'NIEDRIG'}`)}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-12 tabular-nums text-fg-faint">{group.notes.length}</span>
        <button
          type="button"
          aria-label={t('board.zone.addNote', { label: group.label })}
          onClick={() => onCreateInZone(group.key)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-fg-faint',
            'transition-[background-color,color,opacity] duration-150 ease-ds',
            'hover:bg-inset hover:text-fg-1',
            'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
            // Faint at rest so a full board stays quiet, full on hover; always discoverable.
            'opacity-50 group-hover/zone:opacity-100',
          )}
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </header>

      <div className="paper-zone-body">
        <div className="paper-zone-notes">
          {ask && (
            // min-w-0 lets this flex item shrink below the card's 376px, so the card's own
            // max-w-full can cap it to a narrow column instead of spilling past it.
            <div key={ask.key} data-ask className="min-w-0 max-w-full">
              {ask.card}
            </div>
          )}
          {capture && (
            <div key={capture.key} data-capture>
              <InlineCaptureCard
                boardId={capture.boardId}
                placement={capture.placement}
                visibility={capture.visibility}
                layout="card"
                onDone={capture.onDone}
                onNoteId={capture.onNoteId}
                onAsk={capture.onAsk}
              />
            </div>
          )}
          {group.notes.map((note: NoteDto) => (
            <NoteCard
              key={note.id}
              note={note}
              currentUserId={currentUserId}
              selected={selectedNoteId === note.id}
              dragging={activeDragId === note.id}
              onOpen={() => onOpenNote(note.id)}
              pending={pendingFor?.(note.id)}
              relatedCount={relatedCounts?.get(note.id)}
              tidy={tidyFor?.(note.id)}
            />
          ))}
        </div>

        {isEmpty && (
          <div
            className={cn(
              'flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-3 py-6 text-center',
              'transition-colors duration-200 ease-ds',
              'min-h-[76px]',
              isOver && 'border-border-strong',
            )}
          >
            <p className="text-12 font-medium text-fg-3">
              {filteredOut ? t('board.zone.noMatch') : t('board.zone.empty')}
            </p>
            {!filteredOut && <p className="text-12 text-fg-faint">{t('board.zone.emptyHint')}</p>}
          </div>
        )}
        {!capture && (
          <button
            type="button"
            className="paper-zone-add"
            onClick={() => onCreateInZone(group.key)}
          >
            <Plus size={12} strokeWidth={2.4} />
            {t('board.zone.add')}
          </button>
        )}
      </div>
    </section>
  );
}

interface ZoneBandsProps {
  axis: Exclude<BoardAxis, 'free'>;
  groups: NoteGroup<string>[];
  boardId: string;
  /** The note being written; shown at the top of its zone when its placement is a zone. */
  capture: CapturePlacement | null;
  /** Changes with every capture, so each one gets a fresh card. */
  captureKey?: number;
  onCaptureDone: (noteId: string | null, open: boolean, locked: SuggestionFieldKey[]) => void;
  /** Hears each id the note being written is shown under, so the board leaves it to its card. */
  onCaptureNoteId?: (noteId: string) => void;
  /** Hears a question typed into the card; absent when the board's assistant is off. */
  onCaptureAsk?: CaptureAsk;
  /** The answer to a question; shown at the top of its zone when its placement is a zone. */
  ask?: AskSlot | null;
  visibility: NoteVisibility;
  currentUserId: string | undefined;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  onCreateInZone: (key: string) => void;
  activeDragId: string | null;
  filteredOut: boolean;
  /** The pending Wallybot change each note shows, if any (WALLYBOT_INLINE.md §3.3). */
  pendingFor?: (noteId: string) => PendingProps | undefined;
  /** How many notes each note is related to, from the whole board (`relatedCounts`). */
  relatedCounts?: ReadonlyMap<string, number>;
  /** The note's part in a Tidy batch, if any (WALLYBOT_INLINE.md §3.5). */
  tidyFor?: (noteId: string) => TidyProps | undefined;
}

/** Time and priority groups share the open column layout. Never rendered in free mode —
 * WallCanvas swaps this out entirely for the absolute-position free canvas. */
export function ZoneBands({
  axis,
  groups,
  boardId,
  capture,
  captureKey,
  onCaptureDone,
  onCaptureNoteId,
  onCaptureAsk,
  ask,
  visibility,
  ...rest
}: ZoneBandsProps) {
  const zoneCapture = capture?.kind === 'zone' && capture.axis === axis ? capture : null;
  const zoneAsk = ask?.placement.kind === 'zone' && ask.placement.axis === axis ? ask : null;
  return (
    <div className="paper-zones-scroll board-surface wally-scroll min-h-0 overflow-y-auto">
      <div className="paper-zones">
        {groups.map((group) => (
          <ZoneBand
            key={group.key}
            axis={axis}
            group={group}
            capture={
              zoneCapture?.key === group.key
                ? {
                    key: captureKey,
                    boardId,
                    placement: zoneCapture,
                    visibility,
                    onDone: onCaptureDone,
                    onNoteId: onCaptureNoteId,
                    onAsk: onCaptureAsk,
                  }
                : null
            }
            ask={
              zoneAsk && zoneAsk.placement.kind === 'zone' && zoneAsk.placement.key === group.key
                ? zoneAsk
                : null
            }
            {...rest}
          />
        ))}
      </div>
    </div>
  );
}
