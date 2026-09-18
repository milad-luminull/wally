import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * `accent` (apricot) is reserved for the app's sanctioned functional spots only — the
 * add-note button, "Teilen"/"Kopieren"/"Einladen" primary actions, per the design
 * system's "apricot is functional, not decorative" rule. Don't reach for it as a
 * general-purpose "primary" button; use `default` (petrol) for that.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-13 font-medium transition-colors duration-150 ease-ds disabled:pointer-events-none disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-[color:var(--petrol-mid)] active:translate-y-px',
        accent: 'bg-accent text-accent-foreground hover:bg-[color:var(--apricot-dark)] active:translate-y-px',
        outline: 'border border-border bg-card text-fg-1 hover:bg-secondary active:translate-y-px',
        ghost: 'text-fg-muted hover:bg-secondary hover:text-fg-1',
        link: 'text-fg-muted underline-offset-4 hover:text-fg-1 hover:underline p-0 h-auto',
        destructive: 'text-status-danger hover:text-[color:var(--status-danger-bold)]',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-12',
        icon: 'h-8 w-8',
        text: 'h-auto p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';
