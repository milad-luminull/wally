import { useLayoutEffect, useRef } from 'react';

/**
 * Moves the tracked cards from where they were to where they are, after every render that
 * changes their place (WALLYBOT_INLINE.md §3.5: "a 180 ms transform each, staggered"). A card
 * that changes zone is re-parented and remounted, so no CSS transition can carry it; the Web
 * Animations API on the new element can, the way `settleCard` lands a drop. Transform only,
 * nothing under reduced motion (BRAND.md). Measures only the ids given, before and after.
 */
export function useFlip(
  ids: readonly string[],
  { durationMs = 180, staggerMs = 40 }: { durationMs?: number; staggerMs?: number } = {},
) {
  const before = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const after = new Map<string, DOMRect>();
    let index = 0;
    for (const id of ids) {
      const el = document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      after.set(id, rect);
      const was = before.current.get(id);
      if (!was || reduce) continue;
      const dx = was.left - rect.left;
      const dy = was.top - rect.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
        duration: durationMs,
        delay: staggerMs * index++,
        easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        fill: 'backwards',
      });
    }
    before.current = after;
  });
}
