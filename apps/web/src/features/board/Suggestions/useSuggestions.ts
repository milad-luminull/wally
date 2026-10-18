import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SuggestionDto, SuggestionFieldKey, SuggestionList } from '@wally/shared';
import { suggestionFieldKeys } from '@wally/shared';
import { useWallybotPreferences } from '@/lib/preferences';
import { assistantApi } from '@/lib/resources';
import { settleNoteCaches } from '../hooks/mutations/shared';
import { useQueryKeys } from '../hooks/queryKeys';

/** The dot's ring: how long a proposal waits before it is kept (WALLYBOT_INLINE.md §3.3). */
export const COUNTDOWN_MS = 6000;
/** How long "Undo" stays where the dot was after a keep (§3.3). */
export const UNDO_WINDOW_MS = 30_000;
/** A keep that failed on the way (offline, a 5xx) is sent once more after this long. */
export const KEEP_RETRY_MS = 1500;

export type SuggestionPhase = 'asking' | 'pending' | 'kept';
export interface SuggestionMark {
  phase: SuggestionPhase;
  suggestion: SuggestionDto | null;
  fields: SuggestionFieldKey[];
  /** The proposed steps still in the change, by index; all of them at first. */
  subtasks: number[];
  /** The proposed links still in the change, by index; all of them at first. */
  links: number[];
  /**
   * The person said "use mine" (the × on the title line, plan R2): the offered title is gone
   * from the card and the review for this proposal, and cannot be ticked again.
   */
  titleDismissed: boolean;
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
  /**
   * The card's ×: `setField(noteId, field, false)`, except on the title line, where it is
   * "use mine" and drops the offered title altogether (R2). The last field out discards.
   */
  remove: (noteId: string, field: SuggestionFieldKey) => void;
  /**
   * Ticks a proposed field into the change or out of it. Taking out the last one discards the
   * change, as the last × always has, even while an offered title nobody ticked is still on
   * the card: that title is not in the change, so nothing would be left to keep. Ticking the
   * title stops the countdown: only the person keeps a title (plan R2), so the change then
   * waits for Enter, and unticking it again does not start the countdown over: the person has
   * taken the change in hand.
   */
  setField: (noteId: string, field: SuggestionFieldKey, on: boolean) => void;
  /** Ticks one proposed step in or out; the last one out takes `subtasks` out of the change. */
  setSubtask: (noteId: string, index: number, on: boolean) => void;
  setPaused: (noteId: string, paused: boolean) => void;
  /**
   * The board's notes as the cache holds them. A pending change whose note has moved past the
   * revision it was proposed for goes at once: a keep would be refused, and its dashed edge
   * and ring would promise a change that cannot happen.
   */
  syncNotes: (notes: readonly { id: string; revision: number }[]) => void;
}

/** Today in the browser's calendar, as the API expects it; not UTC, which is a day off at night. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** What a proposal puts in the change at first: everything but the title, which is opt-in (plan R2). */
const proposed = (s: SuggestionDto): SuggestionFieldKey[] =>
  suggestionFieldKeys.filter((key) => key !== 'title' && s.fields[key] !== null);
/** Only a change that holds something besides the title may be kept by the countdown (R2). */
const countsDown = (fields: readonly SuggestionFieldKey[]) => fields.some((k) => k !== 'title');

type DecideBody = Parameters<typeof assistantApi.decide>[2];
/** A keep of these fields, with the ticked steps when the steps are among them. */
const keepBody = (
  fields: SuggestionFieldKey[],
  subtasks: number[],
  source: DecideBody['source'],
): DecideBody => ({
  decision: 'keep',
  fields,
  ...(fields.includes('subtasks') ? { subtasks } : {}),
  source,
});

/** A refusal a second try cannot change: the server answered, and said no. */
const isRefusal = (error: unknown) => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
};

/** True when the cache already shows the note past the revision the proposal was made on. */
const outdated = (revisions: ReadonlyMap<string, number>, suggestion: SuggestionDto) =>
  (revisions.get(suggestion.noteId) ?? -1) > suggestion.baseRevision;

/** Per note: the timers and the time the countdown still has when paused. */
interface Clock {
  timer: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
}

type MarkFrom = 'capture' | 'restored';

/**
 * The board's pending changes (WALLYBOT_INLINE.md §3.3, §4). One controller per board holds
 * every note's mark, its countdown and its undo window; the cards only draw and report. Every
 * outcome the server can give (nothing, refused, failed, stale) ends as "no dot", and nothing
 * is said (§3.3, BRAND rule 5). The notes are refetched after a keep or an undo, so the card
 * shows the real values and the AI look is gone (rule 3).
 *
 * The countdown runs only for a proposal made just now, for the person themselves: a record
 * shown again after a reload waits for Enter (the ruling amending plan R5), and so does a
 * proposal that names someone else as the assignee, which needs a named yes (WALLY_AGENT.md
 * §3.2). `currentUserId` is the signed-in person.
 */
export function useSuggestions(
  boardId: string,
  enabled: boolean,
  currentUserId: string | undefined,
): SuggestionsController {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const [wallybot] = useWallybotPreferences();
  const autoApply = wallybot.autoApply;
  const [marks, setMarks] = useState<Map<string, SuggestionMark>>(() => new Map());
  const clocks = useRef(new Map<string, Clock>());
  const undoTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const retryTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  /** The keeps still inside their undo window, most recent last (⌘Z takes the last). */
  const undoable = useRef<string[]>([]);
  /**
   * The notes whose decision is on its way to the server, each with the token of that call.
   * While a note is here, every other keep, discard, undo, remove and pause is refused, so one
   * record never gets two decisions; an answer whose token is gone (the note was asked about
   * again meanwhile) changes nothing.
   */
  const deciding = useRef(new Map<string, symbol>());
  /** The capture call each note is waiting on, by its token. */
  const asking = useRef(new Map<string, symbol>());
  /**
   * The capture calls the person dismissed with Esc before they answered. The server still
   * stores what such a call proposes, so its answer is discarded there as soon as it lands;
   * forgetting it here alone would bring it back on the next visit.
   */
  const dismissed = useRef(new Set<symbol>());
  /** Each note's revision as the cache last showed it (`syncNotes`). */
  const revisions = useRef(new Map<string, number>());
  // Read by timers that fire long after the render that armed them.
  const latestMarks = useRef(marks);
  latestMarks.current = marks;
  const latestUser = useRef(currentUserId);
  latestUser.current = currentUserId;

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
  const stopUndo = useCallback((noteId: string) => {
    const t = undoTimers.current.get(noteId);
    if (t) clearTimeout(t);
    undoTimers.current.delete(noteId);
    undoable.current = undoable.current.filter((id) => id !== noteId);
  }, []);
  /** Every timer and claim the note holds goes; the mark stays until the caller replaces it. */
  const reset = useCallback(
    (noteId: string) => {
      stopClock(noteId);
      stopUndo(noteId);
      deciding.current.delete(noteId);
      asking.current.delete(noteId);
    },
    [stopClock, stopUndo],
  );
  const forget = useCallback(
    (noteId: string) => {
      reset(noteId);
      patch(noteId, null);
    },
    [patch, reset],
  );
  const refetch = useCallback(
    (noteId: string) => settleNoteCaches(queryClient, keys, boardId, noteId),
    [boardId, keys, queryClient],
  );
  /**
   * Keeps the cached pending list in step with what this visit did, so nothing that reads it
   * sees a decided record as pending or misses a new one. The board still reads the list from
   * the server on every visit (below); this is the cache between those reads.
   */
  const syncPending = useCallback(
    (suggestion: SuggestionDto, pending: boolean) => {
      queryClient.setQueryData<SuggestionList>(keys.assistantPending(boardId), (old) =>
        old
          ? {
              suggestions: [
                ...old.suggestions.filter((s) => s.id !== suggestion.id),
                ...(pending ? [suggestion] : []),
              ],
            }
          : old,
      );
    },
    [boardId, keys, queryClient],
  );

  // Declared before the clock helpers so a countdown's expiry can call it.
  const decideRef = useRef<(noteId: string, body: DecideBody) => void>(() => {});

  const armClock = useCallback(
    (noteId: string, remainingMs: number) => {
      stopClock(noteId);
      const timer = setTimeout(() => {
        const mark = latestMarks.current.get(noteId);
        if (!mark || mark.phase !== 'pending') return;
        // The title never rides on a countdown keep (R2); the server would leave it out too.
        const fields = mark.fields.filter((k) => k !== 'title');
        if (fields.length === 0) return;
        decideRef.current(noteId, keepBody(fields, mark.subtasks, 'countdown'));
      }, remainingMs);
      clocks.current.set(noteId, { timer, remainingMs });
    },
    [stopClock],
  );

  const showPending = useCallback(
    (suggestion: SuggestionDto, from: MarkFrom) => {
      if (outdated(revisions.current, suggestion)) {
        forget(suggestion.noteId);
        return;
      }
      const assignee = suggestion.fields.assignee?.value.id;
      const someoneElse = assignee !== undefined && assignee !== latestUser.current;
      const fields = proposed(suggestion);
      const countdown = autoApply && from === 'capture' && !someoneElse && countsDown(fields);
      const endsAt = countdown ? Date.now() + COUNTDOWN_MS : null;
      patch(suggestion.noteId, {
        phase: 'pending',
        suggestion,
        fields,
        subtasks: suggestion.fields.subtasks
          ? suggestion.fields.subtasks.items.map((_, i) => i)
          : [],
        links: suggestion.fields.links
          ? suggestion.fields.links.items.map((item) => item.index)
          : [],
        titleDismissed: false,
        countdownEndsAt: endsAt,
        countdownMs: COUNTDOWN_MS,
        paused: false,
      });
      if (endsAt !== null) armClock(suggestion.noteId, COUNTDOWN_MS);
    },
    [armClock, autoApply, forget, patch],
  );

  const decide = useCallback(
    (noteId: string, body: DecideBody) => {
      const mark = latestMarks.current.get(noteId);
      if (!mark?.suggestion || deciding.current.has(noteId)) return;
      const token = Symbol(noteId);
      deciding.current.set(noteId, token);
      // The countdown and the undo window end here: the decision is taken, only its answer is
      // still to come. ⌘Z moves on to the keep before this one.
      stopClock(noteId);
      stopUndo(noteId);
      if (mark.countdownEndsAt !== null) patch(noteId, { ...mark, countdownEndsAt: null });
      const record = mark.suggestion;
      const current = () => deciding.current.get(noteId) === token;
      const send = (retried: boolean) => {
        void assistantApi
          .decide(boardId, record.id, body)
          .then(({ suggestion }) => {
            syncPending(suggestion, false);
            refetch(noteId);
            if (!current()) return;
            if (suggestion.status === 'KEPT') {
              reset(noteId);
              patch(noteId, {
                phase: 'kept',
                suggestion,
                fields: suggestion.kept?.fields ?? [],
                subtasks: suggestion.kept?.subtasks ?? [],
                links: suggestion.kept?.links ?? [],
                titleDismissed: false,
                countdownEndsAt: null,
                countdownMs: COUNTDOWN_MS,
                paused: false,
              });
              undoable.current = [...undoable.current, noteId];
              undoTimers.current.set(
                noteId,
                setTimeout(() => forget(noteId), UNDO_WINDOW_MS),
              );
            } else forget(noteId);
          })
          // Stale (the person edited meanwhile; the server discards the record), settled
          // elsewhere, gone, or failed: the dot just goes. A direct call, not a mutation, so
          // the global failure toast never hears of it. A keep that never got an answer (the
          // network, a 5xx) is sent once more first: the server resumes it under the same
          // operation ids, so a keep that did land is replayed, not repeated.
          .catch((error: unknown) => {
            if (body.decision === 'keep' && !retried && !isRefusal(error) && current()) {
              const timer = setTimeout(() => {
                retryTimers.current.delete(timer);
                if (current()) send(true);
              }, KEEP_RETRY_MS);
              retryTimers.current.add(timer);
              return;
            }
            syncPending(record, false);
            if (current()) forget(noteId);
            refetch(noteId);
          });
      };
      send(false);
    },
    [boardId, forget, patch, refetch, reset, stopClock, stopUndo, syncPending],
  );
  decideRef.current = decide;

  const request = useCallback<SuggestionsController['request']>(
    (noteId, locked) => {
      if (!enabled) return;
      // A note asked about again starts over: no old countdown, undo window or answer applies.
      reset(noteId);
      const token = Symbol(noteId);
      asking.current.set(noteId, token);
      patch(noteId, {
        phase: 'asking',
        suggestion: null,
        fields: [],
        subtasks: [],
        links: [],
        titleDismissed: false,
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
          if (dismissed.current.delete(token)) {
            // Esc came first: what the server stored for this call is discarded as Esc's.
            if (suggestion)
              void assistantApi
                .decide(boardId, suggestion.id, { decision: 'discard', source: 'esc' })
                .catch(() => {});
            return;
          }
          if (asking.current.get(noteId) !== token) return;
          asking.current.delete(noteId);
          if (suggestion) {
            showPending(suggestion, 'capture');
            syncPending(suggestion, true);
          } else forget(noteId);
        })
        .catch(() => {
          dismissed.current.delete(token);
          if (asking.current.get(noteId) === token) forget(noteId);
        });
    },
    [boardId, enabled, forget, patch, reset, showPending, syncPending],
  );

  const keep = useCallback<SuggestionsController['keep']>(
    (noteId, source) => {
      const mark = latestMarks.current.get(noteId);
      if (mark?.phase !== 'pending' || deciding.current.has(noteId)) return;
      // A title nobody ticked is all there is: nothing to keep, the change keeps waiting.
      if (mark.fields.length === 0) return;
      decide(noteId, keepBody(mark.fields, mark.subtasks, source));
    },
    [decide],
  );
  const discard = useCallback<SuggestionsController['discard']>(
    (noteId, source) => {
      const mark = latestMarks.current.get(noteId);
      if (deciding.current.has(noteId)) return;
      if (mark?.phase === 'asking') {
        const token = asking.current.get(noteId);
        if (token) dismissed.current.add(token);
        forget(noteId);
      } else if (mark?.phase === 'pending') decide(noteId, { decision: 'discard', source });
    },
    [decide, forget],
  );
  const undo = useCallback<SuggestionsController['undo']>(
    (noteId, source) => {
      if (latestMarks.current.get(noteId)?.phase !== 'kept' || deciding.current.has(noteId)) return;
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
  /**
   * Puts a pending change's new choice in place. Nothing left in it discards it, as the last ×
   * always has (an offered title that is not ticked is not in it). A ticked title is the
   * person's to keep (R2), whatever else the change holds: the countdown stops, paused or not,
   * and the change waits for Enter. A change left with the title alone is the same case.
   * Nothing here starts a countdown again, so a title ticked and unticked leaves it stopped.
   */
  const choose = useCallback(
    (noteId: string, mark: SuggestionMark, fields: SuggestionFieldKey[], subtasks: number[]) => {
      if (fields.length === 0) {
        // Taken apart field by field; the record says so.
        decide(noteId, { decision: 'discard', source: 'remove' });
        return;
      }
      const next = { ...mark, fields, subtasks };
      if (fields.includes('title')) {
        stopClock(noteId);
        next.countdownEndsAt = null;
        next.paused = false;
      }
      patch(noteId, next);
    },
    [decide, patch, stopClock],
  );
  const setField = useCallback<SuggestionsController['setField']>(
    (noteId, field, on) => {
      const mark = latestMarks.current.get(noteId);
      if (mark?.phase !== 'pending' || !mark.suggestion || deciding.current.has(noteId)) return;
      if (mark.suggestion.fields[field] === null) return;
      // A title the person turned down with "use mine" is no longer on offer.
      if (field === 'title' && on && mark.titleDismissed) return;
      // Always in the enum's order, the order the server records.
      const fields = on
        ? suggestionFieldKeys.filter((k) => k === field || mark.fields.includes(k))
        : mark.fields.filter((k) => k !== field);
      // The steps ticked back in as a whole come back all at once.
      const subtasks =
        field === 'subtasks' && on && mark.subtasks.length === 0
          ? (mark.suggestion.fields.subtasks?.items.map((_, i) => i) ?? [])
          : mark.subtasks;
      choose(noteId, mark, fields, subtasks);
    },
    [choose],
  );
  const setSubtask = useCallback<SuggestionsController['setSubtask']>(
    (noteId, index, on) => {
      const mark = latestMarks.current.get(noteId);
      if (mark?.phase !== 'pending' || deciding.current.has(noteId)) return;
      const items = mark.suggestion?.fields.subtasks?.items ?? [];
      if (!Number.isInteger(index) || index < 0 || index >= items.length) return;
      // With the steps out of the change (the × or every step unticked), none is ticked: one
      // step ticked back in is that step alone, whichever way the group went out.
      const inChange = mark.fields.includes('subtasks');
      if (!on && !inChange) return;
      const base = inChange ? mark.subtasks : [];
      const subtasks = on
        ? [...new Set([...base, index])].sort((a, b) => a - b)
        : base.filter((i) => i !== index);
      const fields =
        subtasks.length === 0
          ? mark.fields.filter((k) => k !== 'subtasks')
          : suggestionFieldKeys.filter((k) => k === 'subtasks' || mark.fields.includes(k));
      choose(noteId, mark, fields, subtasks);
    },
    [choose],
  );
  const remove = useCallback<SuggestionsController['remove']>(
    (noteId, field) => {
      if (field !== 'title') {
        setField(noteId, field, false);
        return;
      }
      // "Use mine": the offered title goes, ticked or not; a change that held nothing else
      // goes with it, as the last × always has.
      const mark = latestMarks.current.get(noteId);
      if (mark?.phase !== 'pending' || !mark.suggestion || deciding.current.has(noteId)) return;
      if (mark.suggestion.fields.title === null) return;
      choose(
        noteId,
        { ...mark, titleDismissed: true },
        mark.fields.filter((k) => k !== 'title'),
        mark.subtasks,
      );
    },
    [choose, setField],
  );
  const setPaused = useCallback<SuggestionsController['setPaused']>(
    (noteId, paused) => {
      const mark = latestMarks.current.get(noteId);
      // Nothing to pause when no countdown runs; a resume needs a pause before it.
      if (
        mark?.phase !== 'pending' ||
        deciding.current.has(noteId) ||
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

  const syncNotes = useCallback<SuggestionsController['syncNotes']>(
    (notes) => {
      revisions.current = new Map(notes.map((n) => [n.id, n.revision]));
      for (const [noteId, mark] of latestMarks.current) {
        // A keep on its way moves the revision itself, and a kept change is past its base.
        if (mark.phase !== 'pending' || !mark.suggestion || deciding.current.has(noteId)) continue;
        if (outdated(revisions.current, mark.suggestion)) forget(noteId);
      }
    },
    [forget],
  );

  // "Always ask me" switched on: every countdown stops where it is and waits for Enter.
  // Switched off again, the waiting marks keep waiting; only the next proposal counts down.
  const previousAutoApply = useRef(autoApply);
  useEffect(() => {
    if (previousAutoApply.current === autoApply) return;
    previousAutoApply.current = autoApply;
    if (autoApply) return;
    for (const noteId of clocks.current.keys()) stopClock(noteId);
    setMarks((prev) => {
      let changed = false;
      const map = new Map(prev);
      for (const [noteId, mark] of prev) {
        if (mark.phase !== 'pending' || (mark.countdownEndsAt === null && !mark.paused)) continue;
        map.set(noteId, { ...mark, countdownEndsAt: null, paused: false });
        changed = true;
      }
      return changed ? map : prev;
    });
  }, [autoApply, stopClock]);

  // What was pending before a reload or the last visit shows again, waiting for Enter (plan
  // R5 as amended). Read from the server on every visit, never from the cache: a list cached
  // on an earlier visit would show records decided since as pending and miss the ones added
  // since.
  const pendingQuery = useQuery({
    queryKey: keys.assistantPending(boardId),
    queryFn: () => assistantApi.pendingSuggestions(boardId),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const seeded = useRef<string | null>(null);
  const fresh = pendingQuery.isFetchedAfterMount ? pendingQuery.data : undefined;
  useEffect(() => {
    if (!fresh || seeded.current === boardId) return;
    seeded.current = boardId;
    for (const suggestion of fresh.suggestions) {
      // A note this visit already shows (asked, kept, or deciding) keeps what it has.
      if (latestMarks.current.has(suggestion.noteId) || deciding.current.has(suggestion.noteId))
        continue;
      showPending(suggestion, 'restored');
    }
  }, [boardId, fresh, showPending]);

  // Leaving the board: every timer goes; pending records stay on the server for next time.
  useEffect(
    () => () => {
      for (const clock of clocks.current.values()) if (clock.timer) clearTimeout(clock.timer);
      for (const t of undoTimers.current.values()) clearTimeout(t);
      for (const t of retryTimers.current) clearTimeout(t);
    },
    [],
  );

  return useMemo(
    () => ({
      marks,
      request,
      keep,
      discard,
      undo,
      undoLast,
      remove,
      setField,
      setSubtask,
      setPaused,
      syncNotes,
    }),
    [
      discard,
      keep,
      marks,
      remove,
      request,
      setField,
      setPaused,
      setSubtask,
      syncNotes,
      undo,
      undoLast,
    ],
  );
}
