import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NoteDto, NoteHorizon, TidyDto, TidyMoveSource } from '@wally/shared';
import { assistantApi } from '@/lib/resources';
import {
  cancelNoteCaches,
  patchNoteCaches,
  restoreNoteCaches,
  settleNoteCaches,
  snapshotNoteCaches,
  type NoteCacheSnapshot,
} from '../hooks/mutations/shared';
import { useQueryKeys } from '../hooks/queryKeys';
import { nextKeptStamp } from '../Suggestions/keptOrder';
import { UNDO_WINDOW_MS } from '../Suggestions/useSuggestions';
import { candidateSignature, tidyCandidateIds } from './tidyCandidates';

/** How long "Nothing to tidy" stays in the bar (plan R4). */
export const EMPTY_NOTICE_MS = 4000;

export type TidyPhase = 'idle' | 'asking' | 'pending' | 'kept' | 'empty';

/** What a card draws for a note in the batch (plan R6). */
export interface TidyMark {
  to: NoteHorizon;
  from: NoteHorizon;
  reason: string | null;
  source: TidyMoveSource;
  phase: 'pending' | 'kept';
}

export interface TidyController {
  phase: TidyPhase;
  /** Candidates on the board now; 0 hides the affordance (R4). */
  count: number;
  /** Moves still in the batch (pending), or moved (kept). */
  moving: number;
  /**
   * The batch's notes while it is pending or kept and the controller is on: what the wall
   * measures to animate (R8). Empty while off, so no card travels on an axis switch (R10).
   */
  trackedIds: readonly string[];
  markFor: (noteId: string) => TidyMark | undefined;
  tidy: () => void;
  keep: (source: 'enter' | 'click') => void;
  /** Esc or Discard; `remove` when the last note was taken out of the batch (R6). */
  discard: (source: 'esc' | 'click' | 'remove') => void;
  undo: (source: 'esc' | 'click' | 'shortcut') => void;
  /** ⌘Z: undoes the kept batch while its window is open; false when there is none. */
  undoLast: () => boolean;
  /** When the batch `undoLast` would undo was kept (a `nextKeptStamp`), or null (R7). */
  lastKeptAt: () => number | null;
  /** The card's ×: takes the note out of the batch; the last one out discards (R6). */
  remove: (noteId: string) => void;
}

/** Today in the browser's calendar, as the API expects it. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Batch {
  tidy: TidyDto;
  /** Notes taken out with the × while pending. */
  removed: Set<string>;
  /**
   * After a keep: the notes that moved, in the record's order; `null` until the batch is kept.
   * An empty list is a keep that moved nothing (every note skipped), never "not kept yet".
   */
  moved: string[] | null;
}

/** The moves still in the batch (pending), or the ones that moved (kept), in the record's order. */
const activeMoves = (b: Batch) =>
  b.tidy.moves.filter(
    (m) => !b.removed.has(m.noteId) && (b.moved === null || b.moved.includes(m.noteId)),
  );

/**
 * The board's Tidy (WALLYBOT_INLINE.md §3.5, plan R1–R9): one batch at a time. The count is
 * the client's own (the same rule as the server's); the proposal is the server's record; a
 * keep moves the notes in the cache at once so the cards travel (R8) and tells the server,
 * which may skip a note changed since (R5); the undo window is the client's 30 s, as a
 * suggestion's. Nothing is said when the server refuses: the cards go back (BRAND rule 5).
 */
export function useTidy(
  boardId: string,
  enabled: boolean,
  notes: readonly NoteDto[],
  canMove: (note: NoteDto) => boolean,
  busy: ReadonlySet<string>,
): TidyController {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const [phase, setPhase] = useState<TidyPhase>('idle');
  const [batch, setBatch] = useState<Batch | null>(null);
  /** The candidates as they were when the last run ended; the affordance waits for a change (R4). */
  const [lastRun, setLastRun] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshots = useRef(new Map<string, NoteCacheSnapshot>());
  /** The request on its way, so a stale answer changes nothing. */
  const token = useRef<symbol | null>(null);
  // Read by callbacks and timers that run after the render that made them.
  const latestNotes = useRef(notes);
  latestNotes.current = notes;
  const latestBatch = useRef(batch);
  latestBatch.current = batch;
  const latestPhase = useRef(phase);
  latestPhase.current = phase;
  // Read through refs so `rest`, and every callback built on it, keeps its identity even when
  // the caller passes a new `canMove` or `busy` on a render.
  const latestCanMove = useRef(canMove);
  latestCanMove.current = canMove;
  const latestBusy = useRef(busy);
  latestBusy.current = busy;
  const latestEnabled = useRef(enabled);
  latestEnabled.current = enabled;
  /** The stamp of the keep that made the current kept batch (R7). */
  const keptStamp = useRef<number | null>(null);

  const candidates = useMemo(
    () => (enabled ? tidyCandidateIds(notes, localToday(), canMove, busy) : []),
    [busy, canMove, enabled, notes],
  );
  const signature = candidateSignature(notes, candidates);
  const count = phase === 'idle' && signature !== lastRun ? candidates.length : 0;

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  /** Back to idle; the affordance remembers what the board looked like at that moment (R4). */
  const rest = useCallback(() => {
    clearTimer();
    token.current = null;
    keptStamp.current = null;
    snapshots.current.clear();
    setBatch(null);
    setPhase('idle');
    const ids = tidyCandidateIds(
      latestNotes.current,
      localToday(),
      latestCanMove.current,
      latestBusy.current,
    );
    setLastRun(candidateSignature(latestNotes.current, ids));
  }, [clearTimer]);

  const patchAll = useCallback(
    (moves: { noteId: string; horizon: NoteHorizon }[]) => {
      for (const { noteId, horizon } of moves) {
        cancelNoteCaches(queryClient, keys, boardId, noteId);
        if (!snapshots.current.has(noteId))
          snapshots.current.set(noteId, snapshotNoteCaches(queryClient, keys, boardId, noteId));
        patchNoteCaches(queryClient, keys, boardId, noteId, { horizon });
      }
    },
    [boardId, keys, queryClient],
  );
  const restoreAll = useCallback(
    (noteIds: string[]) => {
      for (const noteId of noteIds) {
        const snapshot = snapshots.current.get(noteId);
        if (snapshot) restoreNoteCaches(queryClient, keys, boardId, noteId, snapshot);
        snapshots.current.delete(noteId);
        settleNoteCaches(queryClient, keys, boardId, noteId);
      }
    },
    [boardId, keys, queryClient],
  );

  const tidy = useCallback(() => {
    if (!enabled || latestPhase.current !== 'idle') return;
    const mine = Symbol('tidy');
    token.current = mine;
    setPhase('asking');
    void assistantApi
      .tidy(boardId, {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        today: localToday(),
      })
      .then(({ tidy: proposed }) => {
        if (token.current !== mine) return;
        token.current = null;
        if (!proposed || proposed.moves.length === 0) {
          setPhase('empty');
          clearTimer();
          timer.current = setTimeout(rest, EMPTY_NOTICE_MS);
          return;
        }
        setBatch({ tidy: proposed, removed: new Set(), moved: null });
        setPhase('pending');
      })
      .catch(() => {
        if (token.current === mine) rest();
      });
  }, [boardId, clearTimer, enabled, rest]);

  const keep = useCallback<TidyController['keep']>(
    (source) => {
      const b = latestBatch.current;
      if (!b || latestPhase.current !== 'pending') return;
      const moves = activeMoves(b);
      if (moves.length === 0) return;
      const noteIds = moves.map((m) => m.noteId);
      // The cache first, so the cards travel now; the server's answer follows (R8).
      patchAll(moves.map((m) => ({ noteId: m.noteId, horizon: m.to })));
      setBatch({ ...b, moved: noteIds });
      setPhase('kept');
      keptStamp.current = nextKeptStamp();
      const mine = Symbol('keep');
      token.current = mine;
      void assistantApi
        .decideTidy(boardId, b.tidy.id, { decision: 'keep', noteIds, source })
        .then(({ tidy: decided }) => {
          if (token.current !== mine) return;
          token.current = null;
          if (decided.status !== 'KEPT' || !decided.kept) {
            restoreAll(noteIds);
            rest();
            return;
          }
          const { noteIds: movedIds, skipped } = decided.kept;
          if (movedIds.length === 0) {
            // Every note was skipped: nothing moved, so every card goes back, there is nothing
            // to undo, and nothing is said (R5, R8).
            restoreAll(noteIds);
            rest();
            return;
          }
          // A note the server skipped goes back where it was, without motion (R5, R8).
          if (skipped.length) restoreAll(skipped);
          for (const id of movedIds) settleNoteCaches(queryClient, keys, boardId, id);
          setBatch((current) =>
            current ? { ...current, tidy: decided, moved: movedIds } : current,
          );
          clearTimer();
          timer.current = setTimeout(rest, UNDO_WINDOW_MS);
        })
        .catch(() => {
          if (token.current !== mine) return;
          restoreAll(noteIds);
          rest();
        });
    },
    [boardId, clearTimer, keys, patchAll, queryClient, rest, restoreAll],
  );

  const discard = useCallback<TidyController['discard']>(
    (source) => {
      const b = latestBatch.current;
      if (!b || latestPhase.current !== 'pending') return;
      void assistantApi
        .decideTidy(boardId, b.tidy.id, { decision: 'discard', source })
        .catch(() => {});
      rest();
    },
    [boardId, rest],
  );

  const undo = useCallback<TidyController['undo']>(
    (source) => {
      const b = latestBatch.current;
      if (!b || latestPhase.current !== 'kept' || !b.moved) return;
      const moved = b.moved;
      const back = b.tidy.moves.filter((m) => moved.includes(m.noteId));
      patchAll(back.map((m) => ({ noteId: m.noteId, horizon: m.from })));
      const noteIds = back.map((m) => m.noteId);
      const mine = Symbol('undo');
      token.current = mine;
      keptStamp.current = null;
      setBatch(null);
      setPhase('idle');
      clearTimer();
      void assistantApi
        .decideTidy(boardId, b.tidy.id, { decision: 'undo', source })
        .then(() => {
          for (const id of noteIds) settleNoteCaches(queryClient, keys, boardId, id);
        })
        .catch(() => {
          // The server kept the moves: the cards go back to where the keep put them.
          if (token.current === mine)
            patchAll(back.map((m) => ({ noteId: m.noteId, horizon: m.to })));
          for (const id of noteIds) settleNoteCaches(queryClient, keys, boardId, id);
        })
        .finally(() => {
          if (token.current === mine) rest();
        });
    },
    [boardId, clearTimer, keys, patchAll, queryClient, rest],
  );

  const undoLast = useCallback(() => {
    if (!latestEnabled.current || latestPhase.current !== 'kept' || !latestBatch.current)
      return false;
    undo('shortcut');
    return true;
  }, [undo]);
  const lastKeptAt = useCallback(
    () =>
      latestEnabled.current && latestPhase.current === 'kept' && latestBatch.current
        ? keptStamp.current
        : null,
    [],
  );

  const remove = useCallback<TidyController['remove']>(
    (noteId) => {
      const b = latestBatch.current;
      if (!b || latestPhase.current !== 'pending' || b.removed.has(noteId)) return;
      const removed = new Set(b.removed).add(noteId);
      if (b.tidy.moves.every((m) => removed.has(m.noteId))) {
        discard('remove');
        return;
      }
      setBatch({ ...b, removed });
    },
    [discard],
  );

  // A note edited while the batch is pending leaves it: a keep would skip it anyway (R5).
  useEffect(() => {
    const b = latestBatch.current;
    if (!b || phase !== 'pending') return;
    const revisions = new Map(notes.map((n) => [n.id, n.revision]));
    const stale = b.tidy.moves.filter(
      (m) => !b.removed.has(m.noteId) && (revisions.get(m.noteId) ?? -1) !== m.baseRevision,
    );
    if (stale.length === 0) return;
    const removed = new Set(b.removed);
    for (const m of stale) removed.add(m.noteId);
    if (b.tidy.moves.every((m) => removed.has(m.noteId))) discard('remove');
    else setBatch({ ...b, removed });
  }, [discard, notes, phase]);

  // Leaving the board: the timer goes; a pending record is discarded by the next request (R9).
  useEffect(() => clearTimer, [clearTimer]);

  // Off (the priority wall, the free canvas, the list, the assistant switched off): a request
  // on its way, a pending batch and the notice end here, as on leaving the board; the server's
  // pending record is discarded by the next request (R9, R10). A kept batch stays kept, its
  // answer still to be heard, but out of sight until the horizon wall is back.
  useEffect(() => {
    if (!enabled && (phase === 'asking' || phase === 'pending' || phase === 'empty')) rest();
  }, [enabled, phase, rest]);

  const markFor = useCallback<TidyController['markFor']>(
    (noteId) => {
      if (!enabled || !batch || (phase !== 'pending' && phase !== 'kept')) return undefined;
      const move = activeMoves(batch).find((m) => m.noteId === noteId);
      if (!move) return undefined;
      return {
        to: move.to,
        from: move.from,
        reason: move.reason,
        source: move.source,
        phase: phase === 'kept' ? 'kept' : 'pending',
      };
    },
    [batch, enabled, phase],
  );
  const trackedIds = useMemo(
    () =>
      enabled && batch && (phase === 'pending' || phase === 'kept')
        ? activeMoves(batch).map((m) => m.noteId)
        : [],
    [batch, enabled, phase],
  );

  return useMemo(
    () => ({
      phase,
      count,
      moving: trackedIds.length,
      trackedIds,
      markFor,
      tidy,
      keep,
      discard,
      undo,
      undoLast,
      lastKeptAt,
      remove,
    }),
    [count, discard, keep, lastKeptAt, markFor, phase, remove, tidy, trackedIds, undo, undoLast],
  );
}
