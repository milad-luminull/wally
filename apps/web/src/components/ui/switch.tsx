import * as React from 'react';
import { cn } from '@/lib/cn';

type SwitchProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** A two-state switch. A native button, so Space and Enter work and a <label htmlFor>
 *  names it; no Radix package is installed for this, and one is not worth an image rebuild. */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? 'on' : 'off'}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border bg-inset',
        'transition-colors duration-150 ease-ds motion-reduce:transition-none',
        'data-[state=on]:border-[color:var(--chip-on-border)] data-[state=on]:bg-[color:var(--chip-on)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
        'disabled:cursor-not-allowed disabled:opacity-55',
        '[@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-11',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'block h-3.5 w-3.5 rounded-full bg-surface shadow-e1 transition-transform duration-150 ease-ds motion-reduce:transition-none',
          '[@media(pointer:coarse)]:h-[18px] [@media(pointer:coarse)]:w-[18px]',
          checked
            ? 'translate-x-[18px] [@media(pointer:coarse)]:translate-x-[22px]'
            : 'translate-x-[2px]',
        )}
      />
    </button>
  ),
);
Switch.displayName = 'Switch';
