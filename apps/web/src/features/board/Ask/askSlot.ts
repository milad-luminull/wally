import type { ReactNode } from 'react';
import type { CapturePlacement } from '../Capture/useCapture';

/**
 * The answer card, built by the shell, and the place a view draws it: where the question was
 * written (WALLYBOT_INLINE.md §3.6, plan R3). The views place it as they place the capture
 * card and know nothing else about it.
 */
export interface AskSlot {
  /** Changes with every question, so each one gets a fresh card. */
  key: number;
  placement: CapturePlacement;
  card: ReactNode;
}
