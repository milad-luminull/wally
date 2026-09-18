import { COLOUR_LABELS, noteColourValues, type NoteColour } from '@wally/shared';
import { cn } from '@/lib/cn';
import { noteColourSwatchClass } from '../util/noteDerived';

interface ColorSwatchPickerProps {
  value: NoteColour;
  onChange: (colour: NoteColour) => void;
  disabled?: boolean;
}

/**
 * Exactly the 5 swatches packages/shared's noteColourValues defines — Apricot is not one
 * of them. Finlex's design system reserves apricot for functional accents only (primary
 * CTA, active state, focus ring), never a decorative note-colour choice, so there is no
 * 6th "Apricot" option to render here, unlike the reference mockup.
 */
export function ColorSwatchPicker({ value, onChange, disabled }: ColorSwatchPickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-12 font-semibold text-fg-muted">Farbe</span>
      <div className="flex gap-2.5">
        {noteColourValues.map((colour) => (
          <button
            key={colour}
            type="button"
            disabled={disabled}
            title={COLOUR_LABELS[colour]}
            aria-label={COLOUR_LABELS[colour]}
            aria-pressed={value === colour}
            onClick={() => onChange(colour)}
            className={cn(
              'h-[22px] w-[22px] rounded-full border transition-shadow duration-150 disabled:cursor-not-allowed disabled:opacity-55',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
              noteColourSwatchClass[colour],
              value === colour ? 'border-primary ring-2 ring-white ring-inset' : 'border-border',
            )}
          />
        ))}
      </div>
    </div>
  );
}
