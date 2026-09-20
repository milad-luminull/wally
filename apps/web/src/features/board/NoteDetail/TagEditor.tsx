import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { TAG_MAX_LENGTH } from '@wally/shared';
import { Input } from '@/components/ui/input';
import { FieldLabel } from './Field';

interface TagEditorProps {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  disabled?: boolean;
}

export function TagEditor({ tags, onAdd, onRemove, disabled }: TagEditorProps) {
  const [draft, setDraft] = useState('');

  function commit() {
    const value = draft.trim();
    if (!value) return;
    if (tags.includes(value)) {
      setDraft('');
      return;
    }
    onAdd(value.slice(0, TAG_MAX_LENGTH));
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
      <FieldLabel>Schlagworte</FieldLabel>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border px-2 text-12 text-fg-2"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(tag)}
                aria-label={`${tag} entfernen`}
                className="text-fg-muted transition-colors hover:text-fg-1"
              >
                <X className="h-2.5 w-2.5" strokeWidth={2.4} />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commit}
            placeholder="Hinzufügen"
            aria-label="Schlagwort hinzufügen"
            className="h-6 w-24 border-0 border-b border-border-subtle p-0 text-12 focus-visible:ring-0"
          />
        )}
      </div>
    </div>
  );
}
