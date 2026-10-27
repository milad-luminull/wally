import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FIELD_KEY_MAX_LENGTH,
  FIELD_VALUE_MAX_LENGTH,
  MAX_FIELDS_PER_NOTE,
  findFieldKey,
  normalizeFieldKey,
  type CustomFields,
} from '@wally/shared';
import { ghostFieldClassName } from '@/components/ui/field-styles';
import { useLanguage } from '@/i18n/languageContext';
import { RemoveButton } from '@/components/ui/remove-button';
import { cn } from '@/lib/cn';
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
 * Free-form key/value properties on a note, replacing the old fixed reference field.
 *
 * Rows are sorted by key, for the reader's language, so the panel does not reshuffle when a
 * property is edited — Firestore returns map keys in its own order, which is not the
 * insertion order.
 */
export function CustomFieldEditor({
  fields,
  onSet,
  onRemove,
  keySuggestions = [],
  disabled,
}: CustomFieldEditorProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [keyDraft, setKeyDraft] = useState('');
  const [valueDraft, setValueDraft] = useState('');
  const datalistId = useId();

  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b, language));
  const atCapacity = entries.length >= MAX_FIELDS_PER_NOTE;
  // Suggest only keys this note does not already carry.
  const suggestions = keySuggestions.filter((key) => !findFieldKey(fields, key));

  function commit() {
    const key = normalizeFieldKey(keyDraft);
    const value = valueDraft.trim();
    if (!key || !value) return;
    if (atCapacity && !findFieldKey(fields, key)) return;
    // Typing "customer" when "Customer" exists edits that property rather than adding a twin.
    onSet(
      findFieldKey(fields, key) ?? key.slice(0, FIELD_KEY_MAX_LENGTH),
      value.slice(0, FIELD_VALUE_MAX_LENGTH),
    );
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
      <div className="flex flex-col gap-0.5">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="group/field -mx-1.5 grid min-h-8 grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1.5 text-13 hover:bg-surface-alt"
          >
            <span className="truncate text-12 text-fg-3">{key}</span>
            <span className="min-w-0 break-words text-fg-1">{value}</span>
            {!disabled ? (
              <RemoveButton
                label={t('note.fields.remove', { key })}
                onClick={() => onRemove(key)}
                className="opacity-0 focus-visible:opacity-100 group-hover/field:opacity-100 [@media(pointer:coarse)]:opacity-100"
              />
            ) : (
              <span />
            )}
          </div>
        ))}

        {!disabled && !atCapacity && (
          <div className="mt-1 grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3">
            <input
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              list={datalistId}
              placeholder={t('note.fields.keyPlaceholder')}
              aria-label={t('note.fields.keyAria')}
              className={cn(ghostFieldClassName, '-ml-1.5 w-[calc(100%+6px)] text-12')}
            />
            <datalist id={datalistId}>
              {suggestions.map((key) => (
                <option key={key} value={key} />
              ))}
            </datalist>
            <input
              value={valueDraft}
              onChange={(e) => setValueDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commit}
              placeholder={t('note.fields.valuePlaceholder')}
              aria-label={t('note.fields.valueAria')}
              className={ghostFieldClassName}
            />
          </div>
        )}
      </div>
    </div>
  );
}
