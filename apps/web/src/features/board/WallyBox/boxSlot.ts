import type { ReactNode } from 'react';
import type { CapturePlacement } from './placement';

/** The box anchored where the person double-clicked: the views draw `node` at `placement`. */
export interface BoxSlot {
  /** Changes with every anchoring, so each one gets a fresh box. */
  key: number;
  placement: CapturePlacement;
  node: ReactNode;
}
