import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { NoteDto } from '@wally/shared';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RemoveButton } from '@/components/ui/remove-button';
import { cn } from '@/lib/cn';
import { PriorityIcon } from '../PriorityIcon';
import { dueInfo, dueToneClass, relatedNotes } from '../util/noteDerived';
import { FieldLabel } from './Field';

/**
 * The notes this one is related to, both ways (0005-wallybot-inline.md §3.4, plan L6): a row per
 * note as the answer card lists them, an × on the note's own links, the direction in the
 * row's tooltip, and a picker to link another note of the board. No colour, no badge.
 */
export function RelatedNotes({
  note,
  notes,
  disabled,
  onOpen,
  onAdd,
  onRemove,
}: {
  note: NoteDto;
  /** The board's notes, from the cache the panel already reads. */
  notes: NoteDto[];
  disabled: boolean;
  onOpen: (noteId: string) => void;
  onAdd: (targetId: string) => void;
  onRemove: (targetId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const related = useMemo(() => relatedNotes(note, notes), [note, notes]);
  const linked = useMemo(() => new Set(related.map((r) => r.note.id)), [related]);
  const choices = useMemo(
    () => notes.filter((n) => n.id !== note.id && n.status === 'OPEN' && !linked.has(n.id)),
    [linked, note.id, notes],
  );
  if (related.length === 0 && disabled) return null;
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>{t('note.related.label')}</FieldLabel>
      {related.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-border">
          {related.map(({ note: other, direction }) => {
            const title = other.title || t('common.untitled');
            const due = dueInfo(other, t);
            return (
              <li
                key={other.id}
                className="flex items-center border-b border-border-subtle last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => onOpen(other.id)}
                  title={t(direction === 'out' ? 'note.related.linked' : 'note.related.fromOther', {
                    title,
                  })}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left',
                    'transition-colors duration-120 hover:bg-surface-alt',
                    'focus-visible:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--ring-alpha)]',
                    '[@media(pointer:coarse)]:min-h-11',
                  )}
                >
                  <PriorityIcon priority={other.priority} className="shrink-0 text-fg-3" />
                  <span className="min-w-0 flex-1 truncate text-13 font-medium text-fg-1">
                    {title}
                  </span>
                  <span className={cn('shrink-0 text-12', dueToneClass[due.tone])}>
                    {due.label}
                  </span>
                </button>
                {!disabled && direction === 'out' && (
                  <RemoveButton
                    label={t('note.related.remove', { title })}
                    onClick={() => onRemove(other.id)}
                    className="mr-1"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!disabled && choices.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="self-start text-fg-3">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t('note.related.add')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="z-overlay w-72 p-0">
            <Command label={t('note.related.search')}>
              <CommandInput
                placeholder={t('note.related.search')}
                aria-label={t('note.related.search')}
              />
              <CommandList>
                <CommandEmpty>{t('note.related.empty')}</CommandEmpty>
                <CommandGroup>
                  {choices.map((choice) => (
                    <CommandItem
                      key={choice.id}
                      value={`${choice.title} ${choice.id}`}
                      onSelect={() => {
                        onAdd(choice.id);
                        setOpen(false);
                      }}
                    >
                      <PriorityIcon priority={choice.priority} className="shrink-0 text-fg-3" />
                      <span className="min-w-0 flex-1 truncate">
                        {choice.title || t('common.untitled')}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
