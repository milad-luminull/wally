import { cva } from 'class-variance-authority';

/* Kept apart from button.tsx so the fast-refresh lint rule doesn't flag a non-component
 * export, and so dialog actions and links can borrow the exact button look. */

/**
 * `default` is ink: the everyday filled button. `accent` is marigold and is spent at most
 * ONCE per screen, on that screen's single primary action — today the new-note button on the
 * board and the invite button in the share sheet. See docs/BRAND.md.
 *
 * `destructive` is the one filled red, for the confirm step of a destructive action;
 * `destructive-ghost` is the quiet entry point that leads to it.
 *
 * Sizes are 28 / 32 / 36, and every one grows to at least 40 on a coarse pointer.
 */
export const buttonVariants = cva(
  [
    'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-13 font-medium',
    'transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-ds',
    /* Tactile press: the control gives under the finger and springs back. */
    'active:scale-[0.98] active:duration-75 motion-reduce:active:scale-100',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-e1 hover:bg-primary-hover',
        accent: 'bg-accent text-accent-foreground shadow-e1 hover:bg-accent-hover',
        outline:
          'border border-border bg-surface text-fg-1 shadow-e1 hover:border-border-strong hover:bg-surface-alt',
        ghost:
          'text-fg-3 hover:bg-inset hover:text-fg-1 data-[state=open]:bg-inset data-[state=open]:text-fg-1',
        link: 'h-auto p-0 text-fg-3 underline-offset-4 hover:text-fg-1 hover:underline active:scale-100',
        destructive:
          'bg-destructive text-destructive-foreground shadow-e1 hover:bg-destructive-hover',
        'destructive-ghost': 'text-status-danger hover:bg-destructive-soft',
      },
      size: {
        default: 'h-8 px-3 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:px-4',
        sm: 'h-7 px-2.5 text-12 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-3.5',
        lg: 'h-9 px-4 text-14 [@media(pointer:coarse)]:h-11',
        icon: 'h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
        'icon-sm':
          'h-7 w-7 [&_svg]:size-3.5 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10',
        text: 'h-auto p-0 active:scale-100',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
