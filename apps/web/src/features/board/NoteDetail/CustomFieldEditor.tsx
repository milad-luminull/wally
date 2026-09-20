import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import {
  FIELD_KEY_MAX_LENGTH,
  FIELD_VALUE_MAX_LENGTH,
  MAX_FIELDS_PER_NOTE,
  findFieldKey,
  normalizeFieldKey,
  type CustomFields,
} from '@wally/shared';
import { Input } from '@/components/ui/input';
import { FieldLabel } from './Field';

interface CustomFieldEditorProps {
  fields: CustomFields;
  onSet: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  /** Keys already used elsewhere on this board, offered as autocomplete. */
  keySuggestions?: string[];
  disabled?: boolean;
}

/**
 * Free-form key/value properties on a note, replacing the old fixed "Bezug" field.
 *
 * Rows are sorted by key so the panel does not reshuffle when a property is edited —
 * Firestore returns map keys in its own order, which is not the insertion order.
 */
export function CustomFieldEditor({
  fields,
  onSet,
  onRemove,
  keySuggestions = [],
  disabled,
}: CustomFieldEditorProps) {
  const { t } = useTranslation();
  const [keyDraft, setKeyDraft] = useState('');
  const [valueDraft, setValueDraft] = useState('');
  const datalistId = useId();

  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b, 'de'));
  const atCapacity = entries.length >= MAX_FIELDS_PER_NOTE;
  // Suggest only keys this note does not already carry.
  const suggestions = keySuggestions.filter((key) => !findFieldKey(fields, key));

  function commit() {
    const key = normalizeFieldKey(keyDraft);
    const value = valueDraft.trim();
    if (!key || !value) return;
    if (atCapacity && !findFieldKey(fields, key)) return;
    // Typing "kunde" when "Kunde" exists edits that property rather than adding a twin.
    onSet(findFieldKey(fields, key) ?? key.slice(0, FIELD_KEY_MAX_LENGTH), value.slice(0, FIELD_VALUE_MAX_LENGTH));
    setKeyDraft('');
    setValueDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>{t('note.fields.label')}</FieldLabel>
      <div className="flex flex-col gap-1">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-baseline gap-2 text-12">
            <span className="shrink-0 text-fg-muted">{key}</span>
            <span className="min-w-0 flex-1 break-words text-fg-2">{value}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => onRemove(key)}
                aria-label={t('note.fields.remove', { key })}
                className="shrink-0 p-0.5 text-border-strong transition-colors hover:text-fg-muted"
              >
                <X className="h-[11px] w-[11px]" strokeWidth={2.2} />
              </button>
            )}
          </div>
        ))}

        {!disabled && !atCapacity && (
          <div className="mt-1 flex items-center gap-2">
            <Input
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              list={datalistId}
              placeholder={t('note.fields.keyPlaceholder')}
              aria-label={t('note.fields.keyAria')}
              className="h-[30px] w-[38%] border-0 border-b border-border-subtle p-0 text-12 focus-visible:ring-0"
            />
            <datalist id={datalistId}>
              {suggestions.map((key) => (
                <option key={key} value={key} />
              ))}
            </datalist>
            <Input
              value={valueDraft}
              onChange={(e) => setValueDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commit}
              placeholder={t('note.fields.valuePlaceholder')}
              aria-label={t('note.fields.valueAria')}
              className="h-[30px] min-w-0 flex-1 border-0 border-b border-border-subtle p-0 text-12 focus-visible:ring-0"
            />
          </div>
        )}
      </div>
    </div>
  );
}
