import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's *stock* font-size keys (`xs`, `sm`, `base`, `lg`,
 * …). Our scale is numeric (`text-13`, `text-22`, … — see tailwind.config.ts), and an
 * unrecognised `text-*` class falls into tailwind-merge's **text-color** group. That made
 * every size collide with the colour class beside it, and since the colour almost always
 * comes last, the size lost: `cn('font-head text-18 text-fg-1')` shipped as
 * `font-head text-fg-1` and the element silently rendered at the 14px body default.
 *
 * Registering the scale under `font-size` restores both groups, so size and colour stop
 * fighting. Keep this list in sync with `theme.extend.fontSize`.
 */
const FONT_SIZES = ['11', '12', '13', '14', '15', '18', '22', '26', '32', '40'];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: FONT_SIZES }],
    },
  },
});

/** Merge conditional class lists and resolve Tailwind class conflicts (shadcn's standard helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
