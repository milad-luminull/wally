import { cn } from '@/lib/cn';

/** The footer's pill buttons; the sidebar's kept Undo is the same pill. */
export const footerAction = cn(
  'inline-flex h-6 cursor-pointer items-center rounded-full px-2.5 text-12 font-medium',
  'transition-colors duration-150',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
  '[@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:px-4',
);
