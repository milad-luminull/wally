import * as React from 'react';
import { cn } from '@/lib/cn';
import { menuItemClassName } from './menu-variants';

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
    className={menuItemClassName({ destructive, className })}
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
