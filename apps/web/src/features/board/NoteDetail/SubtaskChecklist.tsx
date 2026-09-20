import { useState, type KeyboardEvent } from 'react';
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
        <FieldLabel>Unteraufgaben</FieldLabel>
        {subtasks.length > 0 && (
          <span className="text-11 text-fg-muted tabular-nums">
            {done} von {subtasks.length}
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
              aria-label={subtask.done ? `${subtask.text} als offen markieren` : `${subtask.text} als erledigt markieren`}
            />
            <span className={cn('flex-1 text-13 leading-snug text-fg-2', subtask.done && 'text-fg-muted line-through')}>
              {subtask.text}
            </span>
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(subtask.id)}
                aria-label={`${subtask.text} entfernen`}
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
            placeholder="Unteraufgabe hinzufügen"
            aria-label="Unteraufgabe hinzufügen"
            className="mt-1 h-[30px] border-0 border-b border-border-subtle p-0 text-13 focus-visible:ring-0"
          />
        )}
      </div>
    </div>
  );
}
