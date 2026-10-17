import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { i18n, initI18n } from '@/i18n';

/**
 * A real instance with the real English catalogue — `t` is never mocked and never returns bare
 * keys, so the suite's assertions on English text double as a regression check on the copy.
 * The German catalogue reaches the screen in `src/i18n/germanSurface.test.tsx` (ADR-0014).
 *
 * `lng` is pinned rather than detected so the suite never depends on what jsdom reports as
 * navigator.language.
 */
initI18n({ lng: 'en' });

afterEach(() => {
  cleanup();
  // A test that switched language must not leak into its neighbour.
  if (i18n.language !== 'en') void i18n.changeLanguage('en');
});

// jsdom doesn't implement matchMedia — used by useReducedMotion/useBreakpoint-adjacent
// code and by some Radix internals.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom doesn't implement ResizeObserver — Radix's Popover/Select/Tooltip positioning uses it.
if (!('ResizeObserver' in window)) {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error jsdom global patch for tests
  window.ResizeObserver = MockResizeObserver;
}

// Radix pointer-based components (Select, Toggle) probe pointer capture APIs jsdom lacks.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/*
 * jsdom's selector engine (nwsapi 2.2.2x) has no support for the top-layer pseudo-classes,
 * and asking it about `:modal` recurses through its `:fullscreen` handling for seconds per
 * call. floating-ui asks exactly that — `:popover-open` and `:modal` — every time a Radix
 * popover, select or tooltip positions itself, which made each "open the menu" test take
 * 7–18s locally and time out on CI. jsdom has no top layer, so the honest answer is always
 * false; give it without the walk.
 */
const TOP_LAYER_SELECTORS = new Set([':modal', ':popover-open']);
const nativeMatches = Element.prototype.matches;
Element.prototype.matches = function matches(this: Element, selectors: string) {
  if (TOP_LAYER_SELECTORS.has(selectors.trim())) return false;
  return nativeMatches.call(this, selectors);
};
