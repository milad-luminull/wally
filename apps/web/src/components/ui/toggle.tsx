import * as React from 'react';
import * as TogglePrimitive from '@radix-ui/react-toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export const toggleVariants = cva(
  [
    'inline-flex select-none items-center justify-center gap-1.5 rounded-md text-12 font-medium [&_svg]:size-3.5',
    'transition-[background-color,color,border-color,box-shadow] duration-150 ease-ds',
    'active:scale-[0.97] active:duration-75 motion-reduce:active:scale-100',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
    'disabled:pointer-events-none disabled:opacity-55',
  ],
  {
    variants: {
      variant: {
        default:
          'border border-transparent text-fg-3 hover:bg-inset hover:text-fg-1 data-[state=on]:bg-inset data-[state=on]:text-fg-1',
        /* A chip that is on fills with ink, so "this filter is applied" reads at a glance
           without spending the screen's one marigold. */
        chip: 'border border-border bg-surface text-fg-2 shadow-e1 hover:border-border-strong hover:text-fg-1 data-[state=on]:border-[color:var(--chip-on-border)] data-[state=on]:bg-[color:var(--chip-on)] data-[state=on]:text-[color:var(--chip-on-foreground)]',
      },
      /* Filter chips are the main thing a thumb goes for in the mobile filter sheet, so
         they grow on a coarse pointer; a mouse keeps the compact row. */
      size: {
        default: 'h-7 px-2.5 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-3.5',
        sm: 'h-6 px-2 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:px-3',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size }), className)}
    {...props}
  />
));
Toggle.displayName = TogglePrimitive.Root.displayName;
