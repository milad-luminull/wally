import { cn } from '@/lib/cn';

/**
 * The one field look, shared by Input, Textarea and SelectTrigger: 32px, a 1px border,
 * 6px radius and the ink focus ring. Grows to 44 on a coarse pointer.
 */
export const fieldClassName = cn(
  'flex h-8 w-full rounded-md border border-input bg-surface px-2.5 text-13 text-fg-1 shadow-e1 outline-none',
  'transition-[border-color,box-shadow] duration-150 ease-ds',
  'placeholder:text-fg-faint hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50',
  'focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
  '[@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-16',
);

/**
 * Borderless until hovered or focused — for fields that live inline in a list (tags, custom
 * fields, subtasks) where a box on every row would be noise. The focus ring is the same.
 */
export const ghostFieldClassName = cn(
  'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-13 text-fg-1 outline-none',
  'transition-[border-color,background-color,box-shadow] duration-150 ease-ds',
  'placeholder:text-fg-faint hover:bg-inset',
  'focus-visible:border-border-strong focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
  '[@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:text-16',
);
