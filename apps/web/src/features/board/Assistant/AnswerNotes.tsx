import { useTranslation } from 'react-i18next';
import type { AssistantChip, NoteDto } from '@wally/shared';
import { cn } from '@/lib/cn';
import { PriorityIcon } from '../PriorityIcon';
import { dueInfo, dueToneClass } from '../util/noteDerived';

/**
 * The notes an answer relied on, listed underneath it (BRAND.md AI rule 8). The chips come
 * from the API and are never parsed out of the answer text; the board's own notes query
 * supplies priority and due date when it knows the note, so the rows read like the list.
 * Once that query has loaded, a chip whose note is gone from the board is dropped (spec 3.2:
 * checked at render time); while it is still loading (`notes` undefined) every chip shows.
 */
export function AnswerNotes({
  chips,
  notes,
  onOpenNote,
}: {
  chips: AssistantChip[];
  notes: NoteDto[] | undefined;
  onOpenNote: (noteId: string) => void;
}) {
  const { t } = useTranslation();
  const shown = notes ? chips.filter((chip) => notes.some((n) => n.id === chip.id)) : chips;
  if (shown.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1 text-12 font-medium text-fg-3">{t('assistant.notesRead')}</p>
      <ul className="overflow-hidden rounded-lg border border-border">
        {shown.map((chip) => {
          const note = notes?.find((n) => n.id === chip.id);
          const due = note ? dueInfo(note, t) : null;
          return (
            <li key={chip.id} className="border-b border-border-subtle last:border-b-0">
              <button
                type="button"
                onClick={() => onOpenNote(chip.id)}
                className={cn(
                  'flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left',
                  'transition-colors duration-120 hover:bg-surface-alt',
                  'focus-visible:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ring-alpha)]',
                  '[@media(pointer:coarse)]:min-h-11',
                )}
              >
                {note && <PriorityIcon priority={note.priority} className="shrink-0 text-fg-3" />}
                <span className="min-w-0 flex-1 truncate text-13 font-medium text-fg-1">
                  {chip.title || t('common.untitled')}
                </span>
                {due && (
                  <span className={cn('shrink-0 text-12', dueToneClass[due.tone])}>
                    {due.label}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
