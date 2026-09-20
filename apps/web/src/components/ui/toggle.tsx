import * as React from 'react';
import * as TogglePrimitive from '@radix-ui/react-toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export const toggleVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 rounded-md text-12 font-medium',
    'transition-[background-color,color,border-color,box-shadow] duration-150 ease-ds',
    'active:scale-[0.97] active:duration-75 motion-reduce:active:scale-100',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
    'disabled:pointer-events-none disabled:opacity-55',
  ],
  {
    variants: {
      variant: {
        default:
          'border border-transparent text-fg-muted hover:bg-inset hover:text-fg-1 data-[state=on]:border-[color:var(--chip-on-border)] data-[state=on]:bg-[color:var(--chip-on)] data-[state=on]:font-semibold data-[state=on]:text-fg-1',
        /* Selected chips read as "filter applied" via a petrol tint + ring, keeping solid
           fills reserved for primary actions. */
        chip: 'h-[28px] rounded-full border border-border bg-card px-3 text-fg-muted hover:border-border-strong hover:text-fg-2 data-[state=on]:border-[color:var(--chip-on-border)] data-[state=on]:bg-[color:var(--chip-on)] data-[state=on]:font-semibold data-[state=on]:text-fg-1',
      },
      /* Filter chips are the main thing a thumb goes for in the mobile filter sheet, so
         they grow on a coarse pointer; a mouse keeps the compact row. */
      size: {
        default: 'h-8 px-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-4',
        sm: 'h-7 px-2 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-3',
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
