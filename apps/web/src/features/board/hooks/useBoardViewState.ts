import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  boardAxisValues,
  boardViewValues,
  boardVisibilityFilterValues,
  notePriorityValues,
  type BoardAxis,
  type BoardPreferences,
  type BoardView,
  type BoardVisibilityFilter,
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
  /** Which notes show: everything, only the user's private notes, or only shared ones. */
  visibility: BoardVisibilityFilter;
  /** Custom-property filter. A key alone matches any note carrying it; with a value it
   *  matches that exact value. */
  fieldKey: string | null;
  fieldValue: string | null;
  noteId: string | null;
}

export const DEFAULT_BOARD_PREFERENCES: BoardPreferences = {
  view: 'wall',
  axis: 'horizon',
  done: true,
  mine: false,
  priority: [],
  visibility: 'all',
};

/** The URL params that carry a remembered setting — dropped once it is saved. */
const REMEMBERED_PARAMS = ['view', 'axis', 'done', 'mine', 'priority', 'visibility'] as const;

type Params = Record<string, string | null>;

/**
 * Single owner of the board's view state, read in this order:
 *
 *   1. the URL — a shared or bookmarked link always shows what its author saw;
 *   2. what this user last chose on this board, saved to their profile;
 *   3. the built-in defaults.
 *
 * Changing a remembered setting (view, grouping, done, mine, priority, visibility) saves it to the
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
    const visibilityParam = searchParams.get('visibility');
    return {
      // A value that is not a board view (a stale link from before ADR-0024, or a typo)
      // is ignored, like every other param below.
      view: (boardViewValues as readonly string[]).includes(viewParam ?? '')
        ? (viewParam as BoardView)
        : base.view,
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
      visibility: (boardVisibilityFilterValues as readonly string[]).includes(visibilityParam ?? '')
        ? (visibilityParam as BoardVisibilityFilter)
        : base.visibility,
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

  /**
   * Saves `change` on top of the current remembered settings, in ONE write: the entry is
   * built from this render's state, so two calls in the same handler would each overwrite
   * the other's field — anything that changes several settings at once must pass them all
   * here together. `alsoClear` names transient URL params to drop in the same navigation.
   */
  const remember = useCallback(
    (change: Partial<BoardPreferences>, alsoClear: readonly string[] = []) => {
      const next: BoardPreferences = {
        view: state.view,
        axis: state.axis,
        done: state.done,
        mine: state.mine,
        priority: state.priority,
        visibility: state.visibility,
        ...change,
      };
      savePreferences({ boards: { [boardId]: next } });
      // Only touch the URL if it actually carries a param to drop; otherwise a no-op
      // navigation would still re-render every route consumer. Dropping a transient filter
      // is a step worth a Back, as it is in setFieldKey; dropping a saved one is not.
      const keys = [...REMEMBERED_PARAMS, ...alsoClear];
      if (keys.some((key) => searchParams.has(key))) {
        setParams(
          Object.fromEntries(keys.map((key) => [key, null])),
          alsoClear.some((key) => searchParams.has(key)) ? 'push' : 'replace',
        );
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
      state.priority.length > 0 ||
      state.visibility !== DEFAULT_BOARD_PREFERENCES.visibility,
    setView: (view: BoardView) => remember({ view }),
    setLayout: (view: BoardView, axis: BoardAxis) => remember({ view, axis }),
    setAxis: (axis: BoardAxis) => remember({ axis }),
    setPriority: (priority: NotePriority[]) => remember({ priority }),
    setMine: (mine: boolean) => remember({ mine }),
    setDone: (done: boolean) => remember({ done }),
    setVisibility: (visibility: BoardVisibilityFilter) => remember({ visibility }),
    /** Puts every filter back to its default — priority, mine, done, visibility and the
     *  property filter — in one saved write and one navigation. View, grouping and search
     *  are left alone; resetView is the one that forgets those too. */
    resetFilters: () =>
      remember({ priority: [], mine: false, done: true, visibility: 'all' }, [
        'field',
        'fieldValue',
      ]),
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
    // A stale `ask` parameter from before slice 4 is dropped when a note opens.
    openNote: (noteId: string | null) =>
      setParams(
        noteId ? { note: noteId, ask: null } : { note: null },
        noteId && state.noteId ? 'replace' : 'push',
      ),
  };
}
