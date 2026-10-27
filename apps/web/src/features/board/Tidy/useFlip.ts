import { useLayoutEffect, useRef } from 'react';

/** The id of every travel this hook starts, so a later render and a drop can find it. */
export const FLIP_ANIMATION_ID = 'tidy-flip';

/** The element's travels that have not ended yet (in their delay or moving). */
function flights(el: HTMLElement): Animation[] {
  if (typeof el.getAnimations !== 'function') return [];
  return el
    .getAnimations()
    .filter(
      (a) => a.id === FLIP_ANIMATION_ID && a.playState !== 'finished' && a.playState !== 'idle',
    );
}

/**
 * Stops a card's travel at once, so whoever moves it next (a drop's own landing, `settleCard`)
 * measures where the card really is and owns its motion alone.
 */
export function cancelFlight(el: HTMLElement) {
  for (const a of flights(el)) a.cancel();
}

/** Where a card was at rest: its zone (when known) and its box in the viewport. */
interface Place {
  zone: string | undefined;
  rect: DOMRect;
}

export interface FlipOptions {
  durationMs?: number;
  staggerMs?: number;
  /**
   * The zone a card is in now. Given, a card travels only when its zone changed since the last
   * render, so a re-render, a scroll or a neighbour leaving moves nothing.
   */
  zoneOf?: (id: string) => string | undefined;
  /**
   * Where a card is meant to go. Given, a card travels only when it arrives there: a card put
   * back (a skip, a refusal, an undo) lands without motion, whichever of the cache and the
   * controller's state reaches the wall first (plan R8).
   */
  destinationOf?: (id: string) => string | undefined;
}

/**
 * Moves the tracked cards from where they were to where they are (0005-wallybot-inline.md §3.5:
 * "a 180 ms transform each, staggered"). A card that changes zone is re-parented and remounted,
 * so no CSS transition can carry it; the Web Animations API on the new element can, the way
 * `settleCard` lands a drop. Transform only, nothing under reduced motion (BRAND.md). Measures
 * only the ids given.
 *
 * A card still travelling is not measured again: its box includes the travel's transform, and
 * a second travel from there would throw it to the far side. Its place at rest, taken when the
 * travel started, stands. The places at rest are taken again on every scroll, so a scrolled
 * column or band row never reads as a move.
 */
export function useFlip(
  ids: readonly string[],
  { durationMs = 180, staggerMs = 40, zoneOf, destinationOf }: FlipOptions = {},
) {
  const before = useRef(new Map<string, Place>());
  const latestIds = useRef(ids);
  latestIds.current = ids;

  useLayoutEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const after = new Map<string, Place>();
    let index = 0;
    for (const id of ids) {
      const el = document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`);
      if (!el) continue;
      const zone = zoneOf?.(id);
      const was = before.current.get(id);
      const zoneChanged = zoneOf ? was !== undefined && was.zone !== zone : true;
      if (!zoneChanged && flights(el).length > 0) {
        // Mid-travel and nowhere new: the travel goes on, the place at rest stands.
        if (was) after.set(id, was);
        continue;
      }
      // Somewhere new while still travelling (the same element, re-rendered): start over from
      // the place at rest it had, not from wherever the old travel had got to.
      cancelFlight(el);
      const rect = el.getBoundingClientRect();
      after.set(id, { zone, rect });
      if (!was || reduce || !zoneChanged) continue;
      if (destinationOf && destinationOf(id) !== zone) continue;
      const dx = was.rect.left - rect.left;
      const dy = was.rect.top - rect.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
        id: FLIP_ANIMATION_ID,
        duration: durationMs,
        delay: staggerMs * index++,
        easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        fill: 'backwards',
      });
    }
    before.current = after;
  });

  // A scroll moves every card in the viewport without a render: the places at rest follow it.
  const tracking = ids.length > 0;
  useLayoutEffect(() => {
    if (!tracking) return;
    const remeasure = () => {
      for (const id of latestIds.current) {
        const was = before.current.get(id);
        if (!was) continue;
        const el = document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`);
        if (!el || flights(el).length > 0) continue;
        before.current.set(id, { zone: was.zone, rect: el.getBoundingClientRect() });
      }
    };
    document.addEventListener('scroll', remeasure, { capture: true, passive: true });
    window.addEventListener('resize', remeasure, { passive: true });
    return () => {
      document.removeEventListener('scroll', remeasure, { capture: true });
      window.removeEventListener('resize', remeasure);
    };
  }, [tracking]);
}
