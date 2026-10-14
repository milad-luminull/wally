import { useTranslation } from 'react-i18next';
import type { NoteVisibility } from '@wally/shared';
import { Switch } from '@/components/ui/switch';
import { PropertyRow } from './Field';

export function VisibilityRow({
  visibility,
  canChange,
  onChange,
}: {
  visibility: NoteVisibility;
  canChange: boolean;
  onChange: (visibility: NoteVisibility) => void;
}) {
  const { t } = useTranslation();
  const isPrivate = visibility === 'PRIVATE';
  const hint = !canChange
    ? t('note.private.needsEdit')
    : isPrivate
      ? t('note.private.hintOn')
      : t('note.private.hintOff');
  return (
    <PropertyRow label={t('note.private.label')} htmlFor="note-private">
      <div className="flex min-w-0 items-center gap-2.5">
        <Switch
          id="note-private"
          checked={isPrivate}
          disabled={!canChange}
          aria-describedby="note-private-hint"
          onCheckedChange={(on) => onChange(on ? 'PRIVATE' : 'SHARED')}
        />
        <span id="note-private-hint" className="min-w-0 text-12 leading-snug text-fg-3">
          {hint}
        </span>
      </div>
    </PropertyRow>
  );
}
