import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { SubtaskDto } from '@wally/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { FieldLabel } from './Field';

interface SubtaskChecklistProps {
  subtasks: SubtaskDto[];
  onAdd: (text: string) => void;
  onToggle: (subtaskId: string, done: boolean) => void;
  onRemove: (subtaskId: string) => void;
  disabled?: boolean;
}

export function SubtaskChecklist({ subtasks, onAdd, onToggle, onRemove, disabled }: SubtaskChecklistProps) {
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
          <span className="text-11 text-fg-muted tabular-nums">
            {t('note.subtasks.progress', { done, total: subtasks.length })}
          </span>
        )}
      </div>
      <div className="flex flex-col">
        {subtasks.map((subtask) => (
          <div key={subtask.id} className="flex items-center gap-2.5 py-1.5">
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
            <span className={cn('flex-1 text-13 leading-snug text-fg-2', subtask.done && 'text-fg-muted line-through')}>
              {subtask.text}
            </span>
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(subtask.id)}
                aria-label={t('note.subtasks.remove', { text: subtask.text })}
                className="p-0.5 text-border-strong transition-colors hover:text-fg-muted"
              >
                <X className="h-[11px] w-[11px]" strokeWidth={2.2} />
              </button>
            )}
          </div>
        ))}
        {!disabled && (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commit}
            placeholder={t('note.subtasks.add')}
            aria-label={t('note.subtasks.add')}
            className="mt-1 h-[30px] border-0 border-b border-border-subtle p-0 text-13 focus-visible:ring-0"
          />
        )}
      </div>
    </div>
  );
}
