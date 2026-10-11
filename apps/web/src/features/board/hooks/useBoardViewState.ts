import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  boardAxisValues,
  notePriorityValues,
  type BoardAxis,
  type BoardPreferences,
  type BoardView,
  type NotePriority,
} from '@wally/shared';
import { usePreferences, useSavePreferences } from '@/lib/preferences';

export type { BoardAxis, BoardView };

export interface BoardViewState {
  view: BoardView;
  axis: BoardAxis;
  q: string;
  priority: NotePriority[];
  mine: boolean;
  done: boolean;
  /** Custom-property filter. A key alone matches any note carrying it; with a value it
   *  matches that exact value. */
  fieldKey: string | null;
  fieldValue: string | null;
  noteId: string | null;
}

export const DEFAULT_BOARD_PREFERENCES: BoardPreferences = {
  view: 'wand',
  axis: 'horizon',
  done: true,
  mine: false,
  priority: [],
};

/** The URL params that carry a remembered setting — dropped once it is saved. */
const REMEMBERED_PARAMS = ['view', 'axis', 'done', 'mine', 'priority'] as const;

type Params = Record<string, string | null>;

/**
 * Single owner of the board's view state, read in this order:
 *
 *   1. the URL — a shared or bookmarked link always shows what its author saw;
 *   2. what this user last chose on this board, saved to their profile;
 *   3. the built-in defaults.
 *
 * Changing a remembered setting (view, grouping, done, mine, priority) saves it to the
 * profile and clears those params from the URL, so the next visit — from any entry point, on
 * any device — opens the board the way it was left. Search, the property filter and the open
 * note stay URL-only: they are transient, and `q` uses `replace` so typing doesn't push one
 * history entry per keystroke.
 */
export function useBoardViewState(boardId: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const saved = usePreferences().boards[boardId];
  const savePreferences = useSavePreferences();

  const state: BoardViewState = useMemo(() => {
    const base = saved ?? DEFAULT_BOARD_PREFERENCES;
    const viewParam = searchParams.get('view');
    const axisParam = searchParams.get('axis');
    const priorityParam = searchParams.get('priority');
    const mineParam = searchParams.get('mine');
    const doneParam = searchParams.get('done');
    return {
      view: viewParam === 'list' || viewParam === 'wand' ? viewParam : base.view,
      axis: (boardAxisValues as readonly string[]).includes(axisParam ?? '')
        ? (axisParam as BoardAxis)
        : base.axis,
      q: searchParams.get('q') ?? '',
      priority:
        priorityParam === null
          ? base.priority
          : priorityParam
              .split(',')
              .filter((p): p is NotePriority =>
                (notePriorityValues as readonly string[]).includes(p),
              ),
      mine: mineParam === null ? base.mine : mineParam === '1',
      done: doneParam === null ? base.done : doneParam !== '0',
      fieldKey: searchParams.get('field'),
      fieldValue: searchParams.get('fieldValue'),
      noteId: searchParams.get('note'),
    };
  }, [searchParams, saved]);

  const setParams = useCallback(
    (updates: Params, mode: 'push' | 'replace') => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: mode === 'replace' },
      );
    },
    [setSearchParams],
  );

  const remember = useCallback(
    (change: Partial<BoardPreferences>) => {
      const next: BoardPreferences = {
        view: state.view,
        axis: state.axis,
        done: state.done,
        mine: state.mine,
        priority: state.priority,
        ...change,
      };
      savePreferences({ boards: { [boardId]: next } });
      // Only touch the URL if it actually carries a remembered param; otherwise a no-op
      // navigation would still re-render every route consumer.
      if (REMEMBERED_PARAMS.some((key) => searchParams.has(key))) {
        setParams(Object.fromEntries(REMEMBERED_PARAMS.map((key) => [key, null])), 'replace');
      }
    },
    [boardId, savePreferences, searchParams, setParams, state],
  );

  return {
    ...state,
    /** True when the board shows something other than the defaults' view settings. */
    isCustomized:
      state.view !== DEFAULT_BOARD_PREFERENCES.view ||
      state.axis !== DEFAULT_BOARD_PREFERENCES.axis ||
      state.done !== DEFAULT_BOARD_PREFERENCES.done ||
      state.mine !== DEFAULT_BOARD_PREFERENCES.mine ||
      state.priority.length > 0,
    setView: (view: BoardView) => remember({ view }),
    setAxis: (axis: BoardAxis) => remember({ axis }),
    setPriority: (priority: NotePriority[]) => remember({ priority }),
    setMine: (mine: boolean) => remember({ mine }),
    setDone: (done: boolean) => remember({ done }),
    /** Forgets this board's saved settings and clears every filter. */
    resetView: () => {
      savePreferences({ boards: { [boardId]: null } });
      setParams(
        Object.fromEntries(
          [...REMEMBERED_PARAMS, 'q', 'field', 'fieldValue'].map((key) => [key, null]),
        ),
        'push',
      );
    },
    setQuery: (q: string) => setParams({ q: q || null }, 'replace'),
    // Clearing the key must clear the value too, or a stale value silently narrows the next
    // property the user picks. One navigation, so both land together.
    setFieldKey: (key: string | null) => setParams({ field: key, fieldValue: null }, 'push'),
    setFieldValue: (value: string | null) => setParams({ fieldValue: value }, 'push'),
    // Opening and closing the panel are steps worth a Back; hopping from one open note to
    // the next is not, or Back would replay every card the user glanced at.
    openNote: (noteId: string | null) =>
      setParams({ note: noteId }, noteId && state.noteId ? 'replace' : 'push'),
  };
}
