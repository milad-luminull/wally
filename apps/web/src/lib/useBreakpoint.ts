import { useSyncExternalStore } from 'react';

/**
 * Single source of truth for the responsive contract (SPEC §11 + the plan's reconciled
 * decision): the whiteboard canvas + drag-and-drop is desktop-only (>=1080px). Both
 * tablet (720–1079px) and mobile (<720px) get the list-only view.
 */
export const BREAKPOINTS = { mobile: 720, tablet: 1080 } as const;

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function getBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  if (w < BREAKPOINTS.mobile) return 'mobile';
  if (w < BREAKPOINTS.tablet) return 'tablet';
  return 'desktop';
}

function subscribe(callback: () => void) {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}

/**
 * Returns the current breakpoint plus booleans. Used to *unmount* (not just hide)
 * desktop-only canvas/drag code below 1080px — see WallView's caller in BoardPage.
 */
export function useBreakpoint() {
  const breakpoint = useSyncExternalStore(subscribe, getBreakpoint, () => 'desktop');
  return {
    breakpoint,
    isMobile: breakpoint === 'mobile',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
    /** true below 1080px — mobile OR tablet, the one place they agree. */
    isBelowDesktop: breakpoint !== 'desktop',
    /** true below 720px — the one place mobile and tablet legitimately differ (FilterBar). */
    isBelowTablet: breakpoint === 'mobile',
  };
}
