import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The one "×" for removing an item from a list — a tag, a subtask, a property, a member.
 * 24px (36 on touch) with a visible focus ring, so it is a real target rather than a glyph.
 */
export const RemoveButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(({ label, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    className={cn(
      'flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-fg-faint',
      'transition-colors duration-100 hover:bg-inset-hover hover:text-fg-1',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
      '[@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9',
      className,
    )}
    {...props}
  >
    <X className="h-3.5 w-3.5" strokeWidth={1.75} />
  </button>
));
RemoveButton.displayName = 'RemoveButton';
