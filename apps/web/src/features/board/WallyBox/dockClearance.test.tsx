import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import { DOCK_CLEARANCE_VAR, useDockClearance } from './dockClearance';

let observed: ((entries: { contentRect: { height: number } }[]) => void) | null = null;
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(callback: typeof observed) {
      observed = callback;
    }
    observe() {}
    disconnect() {}
  },
);

function Dock() {
  const ref = useRef<HTMLDivElement>(null);
  useDockClearance(ref);
  return <div ref={ref} />;
}

const clearance = () => document.documentElement.style.getPropertyValue(DOCK_CLEARANCE_VAR);

afterEach(() => document.documentElement.style.removeProperty(DOCK_CLEARANCE_VAR));

describe('useDockClearance', () => {
  it('says how much room the docked box takes at the bottom, and gives it back when gone', () => {
    const { unmount } = render(<Dock />);
    observed?.([{ contentRect: { height: 64 } }]);
    // The box's height and the gap under it.
    expect(clearance()).toBe('80px');
    observed?.([{ contentRect: { height: 0 } }]);
    expect(clearance()).toBe('0px');
    unmount();
    expect(clearance()).toBe('');
  });
});
