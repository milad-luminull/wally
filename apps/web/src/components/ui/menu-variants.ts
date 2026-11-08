import { cn } from '@/lib/cn';

/** The menu row's look, shared with links that sit in the same menus. */
export function menuItemClassName({
  destructive,
  className,
}: { destructive?: boolean; className?: string } = {}) {
  return cn(
    'flex h-8 w-full select-none items-center gap-2 rounded-[5px] px-2 text-left text-13 outline-none',
    'transition-colors duration-100 hover:bg-inset focus-visible:bg-inset',
    'disabled:pointer-events-none disabled:opacity-50 [@media(pointer:coarse)]:h-11',
    '[&_svg]:size-4 [&_svg]:shrink-0',
    destructive ? 'text-status-danger' : 'text-fg-1 [&_svg]:text-fg-3',
    className,
  );
}
