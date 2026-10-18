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
import { localToday, useToday } from './useToday';

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
 * the client's own (the same rule as the server's) over the notes the caller passes, which
 * are the notes the wall shows; the proposal is the server's record, less any move of a note
 * not shown, so the yes approves only what the person sees (R1). A keep moves the notes in
 * the cache at once so the cards travel (R8) and tells the server, which may skip a note
 * changed since (R5); an undo pressed before the keep's answer waits for it. The undo window
 * is the client's 30 s, as a suggestion's. Nothing is said when the server refuses: the cards
 * go back (BRAND rule 5).
 *
 * The affordance's memory (R4) is written on an outcome only, each at a chosen moment:
 * (a) nothing to tidy: when the notice ends; (b) a discard: at once; (c) a keep: when the
 * server's answer has been applied and the skipped notes are back; (d) an undo: when its
 * answer has arrived and the board's notes have caught up with it (the moves back gave the
 * notes new revisions). A failure (the request, or a keep refused or answered otherwise) and
 * a switch-off while asking or pending write nothing: the affordance comes back for a retry.
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
  // Once per render, renewed at midnight: the count follows the date.
  const today = useToday();
  const [phase, setPhase] = useState<TidyPhase>('idle');
  const [batch, setBatch] = useState<Batch | null>(null);
  /** The candidates as they were when the last run ended; the affordance waits for a change (R4). */
  const [lastRun, setLastRun] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshots = useRef(new Map<string, NoteCacheSnapshot>());
  /** The request on its way, so a stale answer changes nothing. */
  const token = useRef<symbol | null>(null);
  /**
   * The keep on its way, as the server's answer (null when it failed); an undo pressed before
   * it answers is sent after it, so it never overtakes the keep.
   */
  const keepAnswer = useRef<Promise<TidyDto | null> | null>(null);
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
  const latestToday = useRef(today);
  latestToday.current = today;
  /** The stamp of the keep that made the current kept batch (R7). */
  const keptStamp = useRef<number | null>(null);

  const candidates = useMemo(
    () => (enabled ? tidyCandidateIds(notes, today, canMove, busy) : []),
    [busy, canMove, enabled, notes, today],
  );
  const signature = candidateSignature(notes, candidates);
  const count = phase === 'idle' && signature !== lastRun ? candidates.length : 0;

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  /** Back to idle. What the affordance remembers is `remember`'s, on an outcome only (R4). */
  const rest = useCallback(() => {
    clearTimer();
    token.current = null;
    keptStamp.current = null;
    snapshots.current.clear();
    setBatch(null);
    setPhase('idle');
  }, [clearTimer]);
  /**
   * The run's memory (R4): the candidates among the shown notes as the cache has them now, so
   * a patch or a restore made a moment ago counts before the wall has drawn it.
   */
  const remember = useCallback(() => {
    const cached = new Map(
      (queryClient.getQueryData<NoteDto[]>(keys.notes(boardId)) ?? []).map((n) => [n.id, n]),
    );
    const shown = latestNotes.current.map((n) => cached.get(n.id) ?? n);
    const ids = tidyCandidateIds(
      shown,
      latestToday.current,
      latestCanMove.current,
      latestBusy.current,
    );
    setLastRun(candidateSignature(shown, ids));
  }, [boardId, keys, queryClient]);

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
        // Only the notes the wall shows: a move of a note a filter hides is not offered (R1).
        // The server's record keeps it; a keep names the notes it moves.
        const shown = new Set(latestNotes.current.map((n) => n.id));
        const moves = proposed?.moves.filter((m) => shown.has(m.noteId)) ?? [];
        if (!proposed || moves.length === 0) {
          // (a) The pending record, if any, is discarded by the next request (R9).
          setPhase('empty');
          clearTimer();
          timer.current = setTimeout(() => {
            remember();
            rest();
          }, EMPTY_NOTICE_MS);
          return;
        }
        // The cache may lag an edit the server has seen: it catches up now, and a move it then
        // shows stale leaves the batch (the effect below).
        void queryClient.invalidateQueries({ queryKey: keys.notes(boardId) });
        setBatch({ tidy: { ...proposed, moves }, removed: new Set(), moved: null });
        setPhase('pending');
      })
      .catch(() => {
        // A failure is no run: back to idle with the affordance, for a retry.
        if (token.current === mine) rest();
      });
  }, [boardId, clearTimer, enabled, keys, queryClient, remember, rest]);

  const keep = useCallback<TidyController['keep']>(
    (source) => {
      const b = latestBatch.current;
      if (!b || latestPhase.current !== 'pending') return;
      const moves = activeMoves(b);
      if (moves.length === 0) return;
      const noteIds = moves.map((m) => m.noteId);
      // A keep starts from the board as it is now: a snapshot an earlier batch left (its undo
      // still on its way) would restore a state from before that batch.
      snapshots.current.clear();
      // The cache first, so the cards travel now; the server's answer follows (R8).
      patchAll(moves.map((m) => ({ noteId: m.noteId, horizon: m.to })));
      setBatch({ ...b, moved: noteIds });
      setPhase('kept');
      keptStamp.current = nextKeptStamp();
      const mine = Symbol('keep');
      token.current = mine;
      const answer = assistantApi
        .decideTidy(boardId, b.tidy.id, { decision: 'keep', noteIds, source })
        .then(
          ({ tidy: decided }) => decided,
          () => null,
        );
      keepAnswer.current = answer;
      void answer.then((decided) => {
        if (keepAnswer.current === answer) keepAnswer.current = null;
        // An undo pressed meanwhile took the batch over, and reads this answer itself.
        if (token.current !== mine) return;
        token.current = null;
        if (!decided || decided.status !== 'KEPT' || !decided.kept) {
          // Refused, failed or settled otherwise: every card goes back and, no run having
          // happened, the affordance with them.
          restoreAll(noteIds);
          rest();
          return;
        }
        const { noteIds: movedIds, skipped } = decided.kept;
        if (movedIds.length === 0) {
          // Every note was skipped: nothing moved, so every card goes back, there is nothing
          // to undo, and nothing is said (R5, R8). The keep is still the run's outcome (c).
          restoreAll(noteIds);
          remember();
          rest();
          return;
        }
        // A note the server skipped goes back where it was, without motion (R5, R8).
        if (skipped.length) restoreAll(skipped);
        for (const id of movedIds) settleNoteCaches(queryClient, keys, boardId, id);
        remember();
        setBatch((current) => (current ? { ...current, tidy: decided, moved: movedIds } : current));
        clearTimer();
        timer.current = setTimeout(rest, UNDO_WINDOW_MS);
      });
    },
    [boardId, clearTimer, keys, patchAll, queryClient, remember, rest, restoreAll],
  );

  const discard = useCallback<TidyController['discard']>(
    (source) => {
      const b = latestBatch.current;
      if (!b || latestPhase.current !== 'pending') return;
      void assistantApi
        .decideTidy(boardId, b.tidy.id, { decision: 'discard', source })
        .catch(() => {});
      remember();
      rest();
    },
    [boardId, remember, rest],
  );

  const undo = useCallback<TidyController['undo']>(
    (source) => {
      const b = latestBatch.current;
      if (!b || latestPhase.current !== 'kept' || !b.moved) return;
      const shownMoved = b.moved;
      const back = b.tidy.moves.filter((m) => shownMoved.includes(m.noteId));
      // The cards go back at once (R8); the server hears the undo once the keep has answered.
      patchAll(back.map((m) => ({ noteId: m.noteId, horizon: m.from })));
      const mine = Symbol('undo');
      token.current = mine;
      keptStamp.current = null;
      setBatch(null);
      setPhase('idle');
      clearTimer();
      const tidyId = b.tidy.id;
      const settleAll = (ids: readonly string[]) => {
        for (const id of ids) settleNoteCaches(queryClient, keys, boardId, id);
      };
      // (d) Remembered once the board's notes have caught up with the moves back.
      const finish = () =>
        void queryClient.invalidateQueries({ queryKey: keys.notes(boardId) }).then(() => {
          if (token.current !== mine) return;
          remember();
          rest();
        });
      // A keep still on its way is waited for; otherwise `b.moved` is what the server moved.
      const inFlight = keepAnswer.current;
      void (async () => {
        let moved = shownMoved;
        if (inFlight) {
          const decided = await inFlight;
          if (!decided || decided.status !== 'KEPT' || !decided.kept) {
            // The keep failed: nothing moved on the server, so there is nothing to undo, and
            // the cards are back already. No run happened: the affordance comes back.
            restoreAll(back.map((m) => m.noteId));
            if (token.current === mine) rest();
            return;
          }
          moved = decided.kept.noteIds;
          // A note the keep skipped never moved: it is where the undo put it, for good.
          restoreAll(back.filter((m) => !moved.includes(m.noteId)).map((m) => m.noteId));
          if (moved.length === 0) {
            if (token.current === mine) {
              remember();
              rest();
            }
            return;
          }
        }
        try {
          await assistantApi.decideTidy(boardId, tidyId, { decision: 'undo', source });
        } catch {
          // The server kept the moves: the moved cards go back to where the keep put them.
          if (token.current === mine)
            patchAll(
              back
                .filter((m) => moved.includes(m.noteId))
                .map((m) => ({ noteId: m.noteId, horizon: m.to })),
            );
        }
        settleAll(moved);
        finish();
      })();
    },
    [boardId, clearTimer, keys, patchAll, queryClient, remember, rest, restoreAll],
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

  // While the batch is pending, a move leaves it when its note is no longer shown (a filter, a
  // delete), or when the note is past the revision the proposal read: edited since, a keep
  // would skip it anyway (R5). A note behind that revision stays: the cache lags an edit the
  // server had already seen, and catches up (the proposal asked it to).
  useEffect(() => {
    const b = latestBatch.current;
    if (!b || phase !== 'pending') return;
    const revisions = new Map(notes.map((n) => [n.id, n.revision]));
    const stale = b.tidy.moves.filter((m) => {
      if (b.removed.has(m.noteId)) return false;
      const revision = revisions.get(m.noteId);
      return revision === undefined || revision > m.baseRevision;
    });
    if (stale.length === 0) return;
    const removed = new Set(b.removed);
    for (const m of stale) removed.add(m.noteId);
    // A batch emptied this way is discarded with Esc's source: the decision has no source
    // of its own for it, and `remove` stays the ×'s alone.
    if (b.tidy.moves.every((m) => removed.has(m.noteId))) discard('esc');
    else setBatch({ ...b, removed });
  }, [discard, notes, phase]);

  // Leaving the board: the timer goes; a pending record is discarded by the next request (R9).
  useEffect(() => clearTimer, [clearTimer]);

  // Off (the priority wall, the free canvas, the list, the assistant switched off): a request
  // on its way, a pending batch and the notice end here, as on leaving the board; the server's
  // pending record is discarded by the next request (R9, R10). A kept batch stays kept, its
  // answer still to be heard, but out of sight until the horizon wall is back.
  // The notice was an outcome (a); asking or pending was not, so nothing is remembered then.
  useEffect(() => {
    if (enabled) return;
    if (phase === 'empty') remember();
    if (phase === 'asking' || phase === 'pending' || phase === 'empty') rest();
  }, [enabled, phase, remember, rest]);

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
