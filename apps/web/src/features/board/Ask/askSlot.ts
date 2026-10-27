import type { ReactNode } from 'react';
import {
  FREE_CANVAS_HEIGHT,
  FREE_CANVAS_WIDTH,
  NOTE_CARD_HEIGHT,
  NOTE_CARD_WIDTH,
} from '@wally/shared';
import type { CapturePlacement } from '../Capture/useCapture';
import { ASK_CARD_MAX_HEIGHT, ASK_CARD_WIDTH } from './AskCard';

/**
 * The answer card, built by the shell, and the place a view draws it: where the question was
 * written (RFC-0005-wallybot-inline.md §3.6, plan R3). The views place it as they place the capture
 * card and know nothing else about it.
 */
export interface AskSlot {
  /** Changes with every question, so each one gets a fresh card. */
  key: number;
  placement: CapturePlacement;
  card: ReactNode;
}

/** Where the answer card's top-left corner sits on the free canvas: the question's point,
 *  clamped so the card stays on the canvas. */
export function askCardOrigin(placement: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(placement.x, FREE_CANVAS_WIDTH - ASK_CARD_WIDTH)),
    // A tall answer's estimated height, so a question asked near the bottom stays readable.
    y: Math.max(0, Math.min(placement.y, FREE_CANVAS_HEIGHT - ASK_CARD_MAX_HEIGHT)),
  };
}

/** Starts of note-sized stand-ins along one side, so together they cover `size` from `start`. */
function cover(start: number, size: number, unit: number): number[] {
  const starts: number[] = [];
  for (let at = start; at < start + size - unit; at += unit) starts.push(at);
  starts.push(start + Math.max(0, size - unit));
  return starts;
}

/**
 * The places a new note must keep clear of on the free canvas: the notes, and the answer card
 * when one shows there. The question's draft note was deleted (plan R2), so without the card a
 * note started from New note would land on the point the answer occupies. The placement helper
 * knows only note-sized rectangles, so the card is covered by note-sized stand-ins.
 */
export function placementsTaken<T extends { freeX: number; freeY: number }>(
  notes: readonly T[],
  askPlacement: CapturePlacement | null | undefined,
): readonly { freeX: number; freeY: number }[] {
  if (askPlacement?.kind !== 'free') return notes;
  const origin = askCardOrigin(askPlacement);
  const standIns = cover(origin.y, ASK_CARD_MAX_HEIGHT, NOTE_CARD_HEIGHT).flatMap((freeY) =>
    cover(origin.x, ASK_CARD_WIDTH, NOTE_CARD_WIDTH).map((freeX) => ({ freeX, freeY })),
  );
  return [...notes, ...standIns];
}
