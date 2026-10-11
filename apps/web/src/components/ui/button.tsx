import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/**
 * `accent` is dusty blue, and the brand guideline allows at most ONE of it per screen: it is
 * that screen's single primary action. Today that is the add-note button on the board and the
 * invite button in the share sheet. Don't reach for it as a general-purpose "primary" button
 * — use `default` (slate) for that, which is what the guideline means by "Slate: text, mark,
 * primary button". See docs/BRAND.md.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-14 font-medium',
    'transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-ds',
    /* Tactile press: the control gives under the finger and springs back. */
    'active:scale-[0.97] active:duration-75 motion-reduce:active:scale-100',
    'disabled:pointer-events-none disabled:opacity-55',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-e1 hover:bg-[color:var(--slate-hover)] hover:shadow-e2',
        /* White on dusty blue measures 5.08:1 — the 5.1:1 the guideline quotes, and well
           clear of the 3:1 SC 1.4.11 asks of an icon that carries the button's meaning. */
        accent:
          'bg-[color:var(--blue)] text-accent-foreground shadow-e1 hover:bg-[color:var(--blue-hover)] hover:shadow-e2',
        outline:
          'border border-border bg-card text-fg-1 hover:border-border-strong hover:bg-secondary',
        ghost: 'text-fg-muted hover:bg-inset hover:text-fg-1',
        link: 'text-fg-muted underline-offset-4 hover:text-fg-1 hover:underline p-0 h-auto active:scale-100',
        destructive: 'text-status-danger hover:bg-[rgba(146,29,23,0.08)]',
      },
      size: {
        default: 'h-9 px-4 [@media(pointer:coarse)]:h-11',
        sm: 'h-8 px-3 text-12 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-3.5',
        icon: 'h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
        text: 'h-auto p-0 active:scale-100',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';
