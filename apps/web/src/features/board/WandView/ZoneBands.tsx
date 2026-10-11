import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NoteDto } from '@wally/shared';
import { cn } from '@/lib/cn';
import type { BoardAxis } from '../hooks/useBoardViewState';
import type { NoteGroup } from '../util/noteDerived';
import { NoteCard } from './NoteCard';

/** Droppable-region id convention consumed by WandView's onDragEnd. */
export function zoneDroppableId(axis: BoardAxis, key: string) {
  return `zone:${axis}:${key}`;
}

interface ZoneBandProps {
  axis: 'horizon' | 'priority';
  group: NoteGroup<string>;
  currentUserId: string | undefined;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  onCreateInZone: (key: string) => void;
  canEdit: boolean;
  activeDragId: string | null;
  /** Every note on the board is hidden by the filters — say so, rather than "empty". */
  filteredOut: boolean;
}

function ZoneBand({
  axis,
  group,
  currentUserId,
  selectedNoteId,
  onOpenNote,
  onCreateInZone,
  canEdit,
  activeDragId,
  filteredOut,
}: ZoneBandProps) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: zoneDroppableId(axis, group.key) });
  const isEmpty = group.notes.length === 0;

  return (
    <section
      ref={setNodeRef}
      onDoubleClick={() => canEdit && onCreateInZone(group.key)}
      aria-label={t('board.zone.aria', { label: group.label, count: group.notes.length })}
      className={cn(
        'group/zone flex min-w-0 flex-col rounded-xl border transition-[background-color,border-color] duration-200 ease-ds',
        axis === 'horizon' ? 'h-full w-[276px] shrink-0' : 'min-h-[160px] w-full',
        // A quiet panel on the wall rather than an invisible hit area, so the structure of
        // the board is legible even when a column is empty. A drag target darkens a shade and
        // firms its border — no colour, which would read as status or selection.
        isOver
          ? 'border-border-strong bg-[color:var(--zone-surface-over)]'
          : 'border-border-subtle bg-[color:var(--zone-surface)]',
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 pl-3.5 pr-2">
        <h2 className="text-13 font-medium text-fg-1">{group.label}</h2>
        <span className="text-12 tabular-nums text-fg-faint">{group.notes.length}</span>
        <span className="flex-1" />
        {canEdit && (
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
        )}
      </header>

      <div
        className={cn(
          'wally-scroll min-h-0 flex-1 px-2.5 pb-2.5',
          axis === 'horizon' ? 'overflow-y-auto' : 'overflow-hidden',
        )}
      >
        <div className={cn('flex gap-2', axis === 'horizon' ? 'flex-col' : 'flex-row flex-wrap')}>
          {group.notes.map((note: NoteDto) => (
            <NoteCard
              key={note.id}
              note={note}
              currentUserId={currentUserId}
              selected={selectedNoteId === note.id}
              dragging={activeDragId === note.id}
              onOpen={() => onOpenNote(note.id)}
            />
          ))}
        </div>

        {isEmpty && (
          <div
            className={cn(
              'flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-3 py-6 text-center',
              'transition-colors duration-200 ease-ds',
              axis === 'horizon' ? 'h-full min-h-[120px]' : 'min-h-[92px]',
              isOver && 'border-border-strong',
            )}
          >
            <p className="text-12 font-medium text-fg-3">
              {filteredOut ? t('board.zone.noMatch') : t('board.zone.empty')}
            </p>
            {canEdit && !filteredOut && (
              <p className="text-12 text-fg-faint">{t('board.zone.emptyHint')}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

interface ZoneBandsProps {
  axis: Exclude<BoardAxis, 'free'>;
  groups: NoteGroup<string>[];
  currentUserId: string | undefined;
  selectedNoteId: string | null;
  onOpenNote: (id: string) => void;
  onCreateInZone: (key: string) => void;
  canEdit: boolean;
  activeDragId: string | null;
  filteredOut: boolean;
}

/** Horizon → columns side by side; Priority → rows stacked. Never rendered in Frei mode —
 * WandCanvas swaps this out entirely for the absolute-position free canvas. */
export function ZoneBands({ axis, groups, ...rest }: ZoneBandsProps) {
  return (
    <div
      className={cn(
        'board-surface wally-scroll min-w-0 flex-1',
        // `safe center`, not plain `center`: the three bands are fixed-width, so on a wide
        // screen they were pinned left with a few hundred px of bare board to the right and
        // the eye ran off into it. Centred, the leftover reads as margin. The `safe` keyword
        // is what keeps this scrollable — plain `center` puts the overflowing first band out
        // of reach past the scroll origin.
        axis === 'horizon'
          ? 'flex h-full gap-3 overflow-x-auto p-4 [justify-content:safe_center] lg:p-5'
          : 'flex flex-col gap-3 overflow-y-auto p-4 lg:p-5',
      )}
    >
      {groups.map((group) => (
        <ZoneBand key={group.key} axis={axis} group={group} {...rest} />
      ))}
    </div>
  );
}
