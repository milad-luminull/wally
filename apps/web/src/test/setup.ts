import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { i18n, initI18n } from '@/i18n';

/**
 * A real instance with the real German catalogue — `t` is never mocked and never returns bare
 * keys, so the suite's assertions on German text double as a regression check on the copy.
 *
 * `lng` is pinned rather than detected because jsdom reports navigator.language as 'en-US',
 * which would flip every assertion in the suite to English.
 */
initI18n({ lng: 'de' });

afterEach(() => {
  cleanup();
  // A test that switched language must not leak into its neighbour.
  if (i18n.language !== 'de') void i18n.changeLanguage('de');
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
