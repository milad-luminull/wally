import { useDroppable } from '@dnd-kit/core';
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
}

function ZoneBand({ axis, group, currentUserId, selectedNoteId, onOpenNote, onCreateInZone, canEdit }: ZoneBandProps) {
  const { setNodeRef, isOver } = useDroppable({ id: zoneDroppableId(axis, group.key) });

  return (
    <div
      ref={setNodeRef}
      onDoubleClick={() => canEdit && onCreateInZone(group.key)}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border border-dashed p-4 transition-colors duration-150',
        axis === 'horizon' ? 'h-full w-[260px] shrink-0' : 'min-h-[220px] w-full',
        isOver ? 'border-accent bg-[rgba(253,111,82,0.06)]' : 'border-transparent',
      )}
    >
      <div className="flex items-center gap-2 pb-1">
        <span className="text-11 font-semibold uppercase tracking-[0.08em] text-fg-muted">{group.label}</span>
        <span className="text-11 font-semibold text-fg-3 tabular-nums">{group.notes.length}</span>
      </div>
      <div className={cn('flex gap-3', axis === 'horizon' ? 'flex-col' : 'flex-row flex-wrap')}>
        {group.notes.map((note: NoteDto) => (
          <NoteCard
            key={note.id}
            note={note}
            currentUserId={currentUserId}
            selected={selectedNoteId === note.id}
            onOpen={() => onOpenNote(note.id)}
          />
        ))}
        {group.notes.length === 0 && (
          <p className="text-12 text-fg-faint">Keine Notiz hier. Doppelklick legt eine neue an.</p>
        )}
      </div>
    </div>
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
}

/** Horizon → columns side by side; Priority → rows stacked. Never rendered in Frei mode —
 * WandCanvas swaps this out entirely for the absolute-position free canvas. */
export function ZoneBands({ axis, groups, ...rest }: ZoneBandsProps) {
  return (
    <div className={cn('flex h-full gap-4 p-6', axis === 'horizon' ? 'flex-row overflow-x-auto' : 'flex-col overflow-y-auto')}>
      {groups.map((group) => (
        <ZoneBand key={group.key} axis={axis} group={group} {...rest} />
      ))}
    </div>
  );
}
