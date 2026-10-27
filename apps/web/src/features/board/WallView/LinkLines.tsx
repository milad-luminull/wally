import { useMemo } from 'react';
import {
  FREE_CANVAS_HEIGHT,
  FREE_CANVAS_WIDTH,
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
  type NoteDto,
} from '@wally/shared';
import type { PendingProps } from '../Suggestions/pendingProps';

function cardCentre(note: Pick<NoteDto, 'freeX' | 'freeY'>) {
  return { x: note.freeX + NOTE_CARD_WIDTH / 2, y: note.freeY + NOTE_CARD_HEIGHT / 2 };
}

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * The hairlines between related cards on the free canvas (0005-wallybot-inline.md §3.4, plan L5):
 * solid for a kept link, dashed for a link a pending proposal still offers; the note border
 * colour, 1 px, each pair once, under the cards. Positions come from the notes, so a drop
 * moves the line with the card. Zone bands and the list draw none.
 */
export function LinkLines({
  notes,
  pendingFor,
}: {
  notes: readonly NoteDto[];
  pendingFor?: (noteId: string) => PendingProps | undefined;
}) {
  const lines = useMemo(() => {
    const byId = new Map(notes.map((n) => [n.id, n]));
    const out = new Map<string, { from: NoteDto; to: NoteDto; pending: boolean }>();
    for (const note of notes) {
      for (const id of note.links) {
        const target = byId.get(id);
        if (!target) continue;
        const key = pairKey(note.id, id);
        if (!out.has(key) || out.get(key)!.pending)
          out.set(key, { from: note, to: target, pending: false });
      }
      const mark = pendingFor?.(note.id)?.mark;
      if (
        note.links.length > 0 ||
        mark?.phase !== 'pending' ||
        !mark.fields.includes('links') ||
        !mark.suggestion?.fields.links
      )
        continue;
      mark.suggestion.fields.links.items.forEach((item) => {
        if (!mark.links.includes(item.index)) return;
        const target = byId.get(item.noteId);
        if (!target) return;
        const key = pairKey(note.id, item.noteId);
        if (!out.has(key)) out.set(key, { from: note, to: target, pending: true });
      });
    }
    return [...out.entries()];
  }, [notes, pendingFor]);
  if (lines.length === 0) return null;
  return (
    <svg
      data-link-lines
      aria-hidden
      width={FREE_CANVAS_WIDTH}
      height={FREE_CANVAS_HEIGHT}
      className="pointer-events-none absolute inset-0"
    >
      {lines.map(([key, { from, to, pending }]) => {
        const a = cardCentre(from);
        const b = cardCentre(to);
        return (
          <line
            key={key}
            data-link={key}
            data-pending={pending || undefined}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--note-border)"
            strokeWidth={1}
            strokeDasharray={pending ? '4 4' : undefined}
          />
        );
      })}
    </svg>
  );
}
