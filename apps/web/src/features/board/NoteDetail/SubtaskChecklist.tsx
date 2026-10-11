import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { SubtaskDto } from '@wally/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { ghostFieldClassName } from '@/components/ui/field-styles';
import { RemoveButton } from '@/components/ui/remove-button';
import { cn } from '@/lib/cn';
import { FieldLabel } from './Field';

interface SubtaskChecklistProps {
  subtasks: SubtaskDto[];
  onAdd: (text: string) => void;
  onToggle: (subtaskId: string, done: boolean) => void;
  onRemove: (subtaskId: string) => void;
  disabled?: boolean;
}

export function SubtaskChecklist({
  subtasks,
  onAdd,
  onToggle,
  onRemove,
  disabled,
}: SubtaskChecklistProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const done = subtasks.filter((s) => s.done).length;

  function commit() {
    const value = draft.trim();
    if (!value) return;
    onAdd(value);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <FieldLabel>{t('note.subtasks.label')}</FieldLabel>
        {/* One interpolated string, not three JSX children — otherwise the German word
            "von" would stay orphaned in the markup, outside the catalogue. */}
        {subtasks.length > 0 && (
          <span className="text-12 text-fg-3 tabular-nums">
            {t('note.subtasks.progress', { done, total: subtasks.length })}
          </span>
        )}
      </div>
      {subtasks.length > 0 && (
        <div aria-hidden className="h-1 overflow-hidden rounded-full bg-inset">
          <div
            className="h-full rounded-full bg-[color:var(--fg-1)] transition-[width] duration-300 ease-ds"
            style={{ width: `${(done / subtasks.length) * 100}%` }}
          />
        </div>
      )}
      <div className="-mx-1.5 flex flex-col">
        {subtasks.map((subtask) => (
          <div
            key={subtask.id}
            className="group/subtask flex min-h-8 items-center gap-2.5 rounded-md px-1.5 hover:bg-surface-alt"
          >
            <Checkbox
              checked={subtask.done}
              onCheckedChange={(checked) => onToggle(subtask.id, checked === true)}
              disabled={disabled}
              aria-label={
                subtask.done
                  ? t('note.subtasks.markOpen', { text: subtask.text })
                  : t('note.subtasks.markDone', { text: subtask.text })
              }
            />
            <span
              className={cn(
                'flex-1 py-1 text-13 leading-snug text-fg-1',
                subtask.done && 'text-fg-3 line-through decoration-fg-faint',
              )}
            >
              {subtask.text}
            </span>
            {!disabled && (
              <RemoveButton
                label={t('note.subtasks.remove', { text: subtask.text })}
                onClick={() => onRemove(subtask.id)}
                className="opacity-0 focus-visible:opacity-100 group-hover/subtask:opacity-100 [@media(pointer:coarse)]:opacity-100"
              />
            )}
          </div>
        ))}
        {!disabled && (
          <div className="flex items-center gap-1 pl-1.5">
            <Plus aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" strokeWidth={1.75} />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commit}
              placeholder={t('note.subtasks.add')}
              aria-label={t('note.subtasks.add')}
              className={ghostFieldClassName}
            />
          </div>
        )}
      </div>
    </div>
  );
}
