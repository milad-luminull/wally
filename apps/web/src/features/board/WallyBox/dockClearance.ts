import { useEffect, type RefObject } from 'react';

/** The room the docked Wally box takes at the bottom of the window, for what floats there. */
export const DOCK_CLEARANCE_VAR = '--wally-dock-clearance';
/** The gap under the docked box (`.wally-box-dock`'s bottom). */
const DOCK_GAP = 16;

/**
 * Keeps `--wally-dock-clearance` on the page equal to the docked box's height and its gap, so
 * the toasts, the offline line and the unsaved-changes pill float above the box rather than over
 * its field. Zero while the box is hidden; gone with the board.
 */
export function useDockClearance(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.contentRect.height ?? 0;
      root.style.setProperty(DOCK_CLEARANCE_VAR, `${height > 0 ? height + DOCK_GAP : 0}px`);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(DOCK_CLEARANCE_VAR);
    };
  }, [ref]);
}
