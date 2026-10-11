import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TAG_MAX_LENGTH } from '@wally/shared';
import { ghostFieldClassName } from '@/components/ui/field-styles';
import { RemoveButton } from '@/components/ui/remove-button';
import { cn } from '@/lib/cn';
import { FieldLabel } from './Field';

interface TagEditorProps {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  disabled?: boolean;
}

export function TagEditor({ tags, onAdd, onRemove, disabled }: TagEditorProps) {
  const { t } = useTranslation();
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
      <FieldLabel>{t('note.tags.label')}</FieldLabel>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex h-6 items-center gap-0.5 rounded-[5px] border border-border bg-surface-alt pl-2 pr-0.5 text-12 text-fg-2"
          >
            {tag}
            {!disabled && (
              <RemoveButton
                label={t('note.tags.remove', { tag })}
                onClick={() => onRemove(tag)}
                className="h-5 w-5 [&_svg]:h-3 [&_svg]:w-3"
              />
            )}
          </span>
        ))}
        {!disabled && (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commit}
            placeholder={t('note.tags.addPlaceholder')}
            aria-label={t('note.tags.add')}
            className={cn(ghostFieldClassName, 'h-6 w-28 px-1.5 text-12')}
          />
        )}
      </div>
    </div>
  );
}
