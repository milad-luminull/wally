import * as React from 'react';
import { cn } from '@/lib/cn';

/*
 * Menu rows for popovers (board menu, note actions, display options). Plain buttons inside a
 * PopoverContent rather than a full menu primitive: the menus here are short, and a Tab-able
 * list of buttons is accessible without a roving-focus dependency.
 */

export const MenuItem = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: React.ReactNode;
    shortcut?: string;
    destructive?: boolean;
  }
>(({ className, icon, shortcut, destructive, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      'flex h-8 w-full select-none items-center gap-2 rounded-[5px] px-2 text-left text-13 outline-none',
      'transition-colors duration-100 hover:bg-inset focus-visible:bg-inset',
      'disabled:pointer-events-none disabled:opacity-50 [@media(pointer:coarse)]:h-11',
      '[&_svg]:size-4 [&_svg]:shrink-0',
      destructive ? 'text-status-danger' : 'text-fg-1 [&_svg]:text-fg-3',
      className,
    )}
    {...props}
  >
    {icon}
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {shortcut && <kbd className="kbd">{shortcut}</kbd>}
  </button>
));
MenuItem.displayName = 'MenuItem';

export function MenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn('-mx-1 my-1 h-px bg-border-subtle', className)} />;
}
