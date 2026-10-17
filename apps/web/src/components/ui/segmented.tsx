import type * as React from 'react';
import { cn } from '@/lib/cn';

/**
 * Segmented control for the board's view and axis switches.
 *
 * These used to be bare text buttons whose only "selected" signal was a font-weight bump,
 * which read as unstyled links rather than a control. A track with a moving thumb makes
 * the set of options, and which one is live, legible at a glance.
 *
 * Deliberately plain `<button>` elements: the accessible names (the view and axis labels
 * from the catalogue, such as "Board", "List", "Horizon") are what the test suite drives the
 * board with, so the role must stay `button` rather than becoming a radiogroup.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Optional longer description for assistive tech when the label alone is terse. */
  hint?: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex items-center gap-0.5 rounded-md bg-inset p-0.5', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-13 font-medium [&_svg]:size-3.5',
              'transition-[background-color,color,box-shadow] duration-150 ease-ds',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
              selected ? 'bg-surface text-fg-1 shadow-e1' : 'text-fg-3 hover:text-fg-1',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
