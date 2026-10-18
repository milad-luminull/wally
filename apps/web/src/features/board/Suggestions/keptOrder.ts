/**
 * The order in which Wallybot's changes were kept on this page, across the board's controllers
 * (a note's fill-in and a Tidy batch), so ⌘Z can undo the most recent one first (plan R7). A
 * counter rather than the clock: two keeps in the same millisecond still have an order.
 */
let last = 0;

/** A stamp later than every one handed out before it. */
export function nextKeptStamp(): number {
  last += 1;
  return last;
}

/** What ⌘Z needs from a controller that keeps Wallybot changes with an undo window. */
export interface KeptUndo {
  /** The stamp of the newest keep still undoable, or null when there is none. */
  lastKeptAt: () => number | null;
  /** Undoes the newest keep still undoable; false when there is none. */
  undoLast: () => boolean;
}

/**
 * ⌘Z: undoes the most recently kept Wallybot change of all the given controllers that is still
 * in its window; false when none is. A batch kept after a note's fill-in is undone first, and
 * the other way round (plan R7: the batch, "when no kept Wallybot change is more recent").
 */
export function undoMostRecent(controllers: readonly KeptUndo[]): boolean {
  const newest = controllers
    .map((c) => ({ c, at: c.lastKeptAt() }))
    .filter((e): e is { c: KeptUndo; at: number } => e.at !== null)
    .sort((a, b) => b.at - a.at);
  for (const { c } of newest) if (c.undoLast()) return true;
  return false;
}
