import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NoteDto } from '@wally/shared';
import { cn } from '@/lib/cn';
import type { BoardAxis } from '../hooks/useBoardViewState';
import type { NoteGroup } from '../util/noteDerived';
import type { BoxSlot } from '../WallyBox/boxSlot';
import type { PendingProps } from '../Suggestions/pendingProps';
import type { TidyProps } from '../Tidy/tidyProps';
import { NoteCard } from './NoteCard';
import type { InlineEditProps } from '../Capture/inlineEdit';
import type { NoteCardActions } from './NoteCardActions';
import { zoneDroppableId } from './zoneDroppableId';

interface ZoneBandProps {
  axis: 'horizon' | 'priority';
  group: NoteGroup<string>;
  /** Set on the one zone the Wally box was opened in: drawn at the top of the zone. */
  box: BoxSlot | null;
  currentUserId: string | undefined;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  cardActions?: (note: NoteDto) => NoteCardActions;
  onCreateInZone: (key: string) => void;
  activeDragId: string | null;
  /** Every note on the board is hidden by the filters — say so, rather than "empty". */
  filteredOut: boolean;
  /** The pending Wallybot change each note shows, if any (RFC-0005-wallybot-inline.md §3.3). */
  pendingFor?: (noteId: string) => PendingProps | undefined;
  /** Editing a note's words in place, for a note the person may edit. */
  editFor?: (note: NoteDto) => InlineEditProps | undefined;
  /** How many notes each note is related to, from the whole board (`relatedCounts`). */
  relatedCounts?: ReadonlyMap<string, number>;
  /** The note's part in a Tidy batch, if any (RFC-0005-wallybot-inline.md §3.5). */
  tidyFor?: (noteId: string) => TidyProps | undefined;
}

function ZoneBand({
  axis,
  group,
  box,
  currentUserId,
  selectedNoteId,
  onOpenNote,
  cardActions,
  onCreateInZone,
  activeDragId,
  filteredOut,
  pendingFor,
  editFor,
  relatedCounts,
  tidyFor,
}: ZoneBandProps) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: zoneDroppableId(axis, group.key) });
  const isEmpty = group.notes.length === 0 && !box;

  return (
    <section
      ref={setNodeRef}
      onDoubleClick={(e) => {
        // A double-click on a card edits it; selecting a word in the box is not a request for a
        // note either.
        if ((e.target as HTMLElement).closest('[data-note-id], [data-wally-box]')) return;
        onCreateInZone(group.key);
      }}
      aria-label={t('board.zone.aria', { label: group.label, count: group.notes.length })}
      className={cn('paper-zone group/zone', isOver && 'paper-zone-over')}
    >
      <header className="paper-zone-header">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-fg-1">{group.label}</h2>
        {axis === 'priority' && (
          <span className="paper-zone-subtitle">
            {t(`board.zone.priorityHints.${group.key as 'HIGH' | 'MEDIUM' | 'LOW'}`)}
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
          {box && (
            // min-w-0 lets the box shrink to a narrow column instead of spilling past it.
            <div key={box.key} className="min-w-0 max-w-full">
              {box.node}
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
              actions={cardActions?.(note)}
              pending={pendingFor?.(note.id)}
              edit={editFor?.(note)}
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
        {!box && (
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
  /** The Wally box; drawn at the top of its zone when its placement is a zone. */
  box?: BoxSlot | null;
  currentUserId: string | undefined;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  cardActions?: (note: NoteDto) => NoteCardActions;
  onCreateInZone: (key: string) => void;
  activeDragId: string | null;
  filteredOut: boolean;
  /** The pending Wallybot change each note shows, if any (RFC-0005-wallybot-inline.md §3.3). */
  pendingFor?: (noteId: string) => PendingProps | undefined;
  /** Editing a note's words in place, for a note the person may edit. */
  editFor?: (note: NoteDto) => InlineEditProps | undefined;
  /** How many notes each note is related to, from the whole board (`relatedCounts`). */
  relatedCounts?: ReadonlyMap<string, number>;
  /** The note's part in a Tidy batch, if any (RFC-0005-wallybot-inline.md §3.5). */
  tidyFor?: (noteId: string) => TidyProps | undefined;
}

/** Time and priority groups share the open column layout. Never rendered in free mode —
 * WallCanvas swaps this out entirely for the absolute-position free canvas. */
export function ZoneBands({ axis, groups, box, ...rest }: ZoneBandsProps) {
  const zoneBox =
    box?.placement.kind === 'zone' && box.placement.axis === axis ? box.placement.key : null;
  return (
    <div className="paper-zones-scroll board-surface wally-scroll min-h-0 overflow-y-auto">
      <div className="paper-zones">
        {groups.map((group) => (
          <ZoneBand
            key={group.key}
            axis={axis}
            group={group}
            box={zoneBox === group.key ? (box ?? null) : null}
            {...rest}
          />
        ))}
      </div>
    </div>
  );
}
