import * as React from 'react';
import * as TogglePrimitive from '@radix-ui/react-toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export const toggleVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md text-12 font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] disabled:pointer-events-none disabled:opacity-55',
  {
    variants: {
      variant: {
        default: 'text-fg-muted hover:bg-secondary data-[state=on]:bg-inset data-[state=on]:text-fg-1 data-[state=on]:font-semibold',
        chip: 'h-[26px] border border-border px-2.5 text-fg-muted hover:border-border-strong data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground',
      },
      size: { default: 'h-8 px-2', sm: 'h-7 px-1.5' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root ref={ref} className={cn(toggleVariants({ variant, size }), className)} {...props} />
));
Toggle.displayName = TogglePrimitive.Root.displayName;
