import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SuggestionDto, SuggestionFieldKey } from '@wally/shared';
import { suggestionFieldKeys } from '@wally/shared';
import { useWallybotPreferences } from '@/lib/preferences';
import { assistantApi } from '@/lib/resources';
import { settleNoteCaches } from '../hooks/mutations/shared';
import { useQueryKeys } from '../hooks/queryKeys';

/** The dot's ring: how long a proposal waits before it is kept (WALLYBOT_INLINE.md §3.3). */
export const COUNTDOWN_MS = 6000;
/** How long "Undo" stays where the dot was after a keep (§3.3). */
export const UNDO_WINDOW_MS = 30_000;

export type SuggestionPhase = 'asking' | 'pending' | 'kept';
export interface SuggestionMark {
  phase: SuggestionPhase;
  suggestion: SuggestionDto | null;
  fields: SuggestionFieldKey[];
  countdownEndsAt: number | null;
  countdownMs: number;
  paused: boolean;
}
export interface SuggestionsController {
  marks: ReadonlyMap<string, SuggestionMark>;
  request: (noteId: string, locked: SuggestionFieldKey[]) => void;
  keep: (noteId: string, source: 'enter' | 'countdown' | 'click') => void;
  discard: (noteId: string, source: 'esc') => void;
  undo: (noteId: string, source: 'esc' | 'click' | 'shortcut') => void;
  undoLast: () => boolean;
  remove: (noteId: string, field: SuggestionFieldKey) => void;
  setPaused: (noteId: string, paused: boolean) => void;
}

/** Today in the browser's calendar, as the API expects it; not UTC, which is a day off at night. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const proposed = (s: SuggestionDto): SuggestionFieldKey[] =>
  suggestionFieldKeys.filter((key) => s.fields[key] !== null);

/** Per note: the timers and the time the countdown still has when paused. */
interface Clock {
  timer: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
}

/**
 * The board's pending changes (WALLYBOT_INLINE.md §3.3, §4). One controller per board holds
 * every note's mark, its countdown and its undo window; the cards only draw and report. Every
 * outcome the server can give (nothing, refused, failed, stale) ends as "no dot", and nothing
 * is said (§3.3, BRAND rule 5). The notes are refetched after a keep or an undo, so the card
 * shows the real values and the AI look is gone (rule 3).
 */
export function useSuggestions(boardId: string, enabled: boolean): SuggestionsController {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const [wallybot] = useWallybotPreferences();
  const autoApply = wallybot.autoApply;
  const [marks, setMarks] = useState<Map<string, SuggestionMark>>(() => new Map());
  const clocks = useRef(new Map<string, Clock>());
  const undoTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** The keeps still inside their undo window, most recent last (⌘Z takes the last). */
  const undoable = useRef<string[]>([]);
  // Read by timers that fire long after the render that armed them.
  const latestMarks = useRef(marks);
  latestMarks.current = marks;

  const patch = useCallback((noteId: string, next: SuggestionMark | null) => {
    setMarks((prev) => {
      const map = new Map(prev);
      if (next) map.set(noteId, next);
      else map.delete(noteId);
      return map;
    });
  }, []);
  const stopClock = useCallback((noteId: string) => {
    const clock = clocks.current.get(noteId);
    if (clock?.timer) clearTimeout(clock.timer);
    clocks.current.delete(noteId);
  }, []);
  const forget = useCallback(
    (noteId: string) => {
      stopClock(noteId);
      const t = undoTimers.current.get(noteId);
      if (t) clearTimeout(t);
      undoTimers.current.delete(noteId);
      undoable.current = undoable.current.filter((id) => id !== noteId);
      patch(noteId, null);
    },
    [patch, stopClock],
  );
  const refetch = useCallback(
    (noteId: string) => settleNoteCaches(queryClient, keys, boardId, noteId),
    [boardId, keys, queryClient],
  );

  // Declared before the clock helpers so a countdown's expiry can call it.
  const decideRef = useRef<
    (noteId: string, body: Parameters<typeof assistantApi.decide>[2]) => void
  >(() => {});

  const armClock = useCallback(
    (noteId: string, remainingMs: number) => {
      stopClock(noteId);
      const timer = setTimeout(() => {
        const mark = latestMarks.current.get(noteId);
        if (!mark || mark.phase !== 'pending') return;
        decideRef.current(noteId, { decision: 'keep', fields: mark.fields, source: 'countdown' });
      }, remainingMs);
      clocks.current.set(noteId, { timer, remainingMs });
    },
    [stopClock],
  );

  const showPending = useCallback(
    (suggestion: SuggestionDto) => {
      const endsAt = autoApply ? Date.now() + COUNTDOWN_MS : null;
      patch(suggestion.noteId, {
        phase: 'pending',
        suggestion,
        fields: proposed(suggestion),
        countdownEndsAt: endsAt,
        countdownMs: COUNTDOWN_MS,
        paused: false,
      });
      if (endsAt !== null) armClock(suggestion.noteId, COUNTDOWN_MS);
    },
    [armClock, autoApply, patch],
  );

  const decide = useCallback(
    (noteId: string, body: Parameters<typeof assistantApi.decide>[2]) => {
      const mark = latestMarks.current.get(noteId);
      if (!mark?.suggestion) return;
      stopClock(noteId);
      const id = mark.suggestion.id;
      void assistantApi
        .decide(boardId, id, body)
        .then(({ suggestion }) => {
          if (suggestion.status === 'KEPT') {
            patch(noteId, {
              phase: 'kept',
              suggestion,
              fields: suggestion.kept?.fields ?? [],
              countdownEndsAt: null,
              countdownMs: COUNTDOWN_MS,
              paused: false,
            });
            undoable.current = [...undoable.current.filter((n) => n !== noteId), noteId];
            undoTimers.current.set(
              noteId,
              setTimeout(() => forget(noteId), UNDO_WINDOW_MS),
            );
          } else forget(noteId);
        })
        // Stale (the person edited meanwhile), settled elsewhere, gone, or failed: the dot just
        // goes. A direct call, not a mutation, so the global failure toast never hears of it.
        .catch(() => forget(noteId))
        .finally(() => refetch(noteId));
    },
    [boardId, forget, patch, refetch, stopClock],
  );
  decideRef.current = decide;

  const request = useCallback<SuggestionsController['request']>(
    (noteId, locked) => {
      if (!enabled) return;
      patch(noteId, {
        phase: 'asking',
        suggestion: null,
        fields: [],
        countdownEndsAt: null,
        countdownMs: COUNTDOWN_MS,
        paused: false,
      });
      void assistantApi
        .suggest(boardId, {
          noteId,
          locked,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          today: localToday(),
        })
        .then(({ suggestion }) => {
          const still = latestMarks.current.get(noteId);
          if (!still || still.phase !== 'asking') return;
          if (suggestion) showPending(suggestion);
          else forget(noteId);
        })
        .catch(() => forget(noteId));
    },
    [boardId, enabled, forget, patch, showPending],
  );

  const keep = useCallback<SuggestionsController['keep']>(
    (noteId, source) => {
      const mark = latestMarks.current.get(noteId);
      if (mark?.phase !== 'pending') return;
      decide(noteId, { decision: 'keep', fields: mark.fields, source });
    },
    [decide],
  );
  const discard = useCallback<SuggestionsController['discard']>(
    (noteId, source) => {
      const mark = latestMarks.current.get(noteId);
      if (mark?.phase === 'asking') forget(noteId);
      else if (mark?.phase === 'pending') decide(noteId, { decision: 'discard', source });
    },
    [decide, forget],
  );
  const undo = useCallback<SuggestionsController['undo']>(
    (noteId, source) => {
      if (latestMarks.current.get(noteId)?.phase !== 'kept') return;
      decide(noteId, { decision: 'undo', source });
    },
    [decide],
  );
  const undoLast = useCallback<SuggestionsController['undoLast']>(() => {
    const noteId = undoable.current.at(-1);
    if (!noteId) return false;
    undo(noteId, 'shortcut');
    return true;
  }, [undo]);
  const remove = useCallback<SuggestionsController['remove']>(
    (noteId, field) => {
      const mark = latestMarks.current.get(noteId);
      if (mark?.phase !== 'pending') return;
      const fields = mark.fields.filter((f) => f !== field);
      if (fields.length === 0) {
        decide(noteId, { decision: 'discard', source: 'esc' });
        return;
      }
      patch(noteId, { ...mark, fields });
    },
    [decide, patch],
  );
  const setPaused = useCallback<SuggestionsController['setPaused']>(
    (noteId, paused) => {
      const mark = latestMarks.current.get(noteId);
      // Nothing to pause when no countdown runs; a resume needs a pause before it.
      if (
        mark?.phase !== 'pending' ||
        mark.paused === paused ||
        (mark.countdownEndsAt === null && paused)
      )
        return;
      if (!autoApply) return;
      if (paused) {
        const remaining = Math.max(0, (mark.countdownEndsAt ?? Date.now()) - Date.now());
        stopClock(noteId);
        clocks.current.set(noteId, { timer: null, remainingMs: remaining });
        patch(noteId, { ...mark, paused: true, countdownEndsAt: null });
      } else {
        const remaining = clocks.current.get(noteId)?.remainingMs ?? COUNTDOWN_MS;
        patch(noteId, { ...mark, paused: false, countdownEndsAt: Date.now() + remaining });
        armClock(noteId, remaining);
      }
    },
    [armClock, autoApply, patch, stopClock],
  );

  // What was pending before a reload shows again, its countdown restarted (plan R5).
  const pendingQuery = useQuery({
    queryKey: keys.assistantPending(boardId),
    queryFn: () => assistantApi.pendingSuggestions(boardId),
    enabled,
    staleTime: Infinity,
  });
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingQuery.data || seeded.current === boardId) return;
    seeded.current = boardId;
    for (const suggestion of pendingQuery.data.suggestions) showPending(suggestion);
  }, [boardId, pendingQuery.data, showPending]);

  // Leaving the board: every timer goes; pending records stay on the server for next time.
  useEffect(
    () => () => {
      for (const clock of clocks.current.values()) if (clock.timer) clearTimeout(clock.timer);
      for (const t of undoTimers.current.values()) clearTimeout(t);
    },
    [],
  );

  return useMemo(
    () => ({ marks, request, keep, discard, undo, undoLast, remove, setPaused }),
    [discard, keep, marks, remove, request, setPaused, undo, undoLast],
  );
}
