import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { NotePriority } from '@wally/shared';

export type BoardView = 'wand' | 'list';
export type BoardAxis = 'horizon' | 'priority' | 'free';

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

const VALID_PRIORITIES: readonly NotePriority[] = ['HOCH', 'MITTEL', 'NIEDRIG'];

/**
 * Single owner of the board's URL-bound state. Everything here is genuinely bookmarkable
 * — `q` updates use `replace` (so typing a search doesn't spam browser history with one
 * entry per keystroke), every other setter uses `push` (so back/forward moves through
 * filter/view/selection changes a user actually intended as steps).
 */
export function useBoardViewState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const state: BoardViewState = useMemo(() => {
    const viewParam = searchParams.get('view');
    const axisParam = searchParams.get('axis');
    const priorityParam = searchParams.get('priority');
    return {
      view: viewParam === 'list' ? 'list' : 'wand',
      axis: axisParam === 'priority' || axisParam === 'free' ? axisParam : 'horizon',
      q: searchParams.get('q') ?? '',
      priority: (priorityParam
        ?.split(',')
        .filter((p): p is NotePriority => VALID_PRIORITIES.includes(p as NotePriority)) ??
        []) as NotePriority[],
      mine: searchParams.get('mine') === '1',
      done: searchParams.get('done') !== '0',
      fieldKey: searchParams.get('field'),
      fieldValue: searchParams.get('fieldValue'),
      noteId: searchParams.get('note'),
    };
  }, [searchParams]);

  const setParam = useCallback(
    (key: string, value: string | null, mode: 'push' | 'replace') => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: mode === 'replace' },
      );
    },
    [setSearchParams],
  );

  return {
    ...state,
    setView: (view: BoardView) => setParam('view', view === 'wand' ? null : view, 'push'),
    setAxis: (axis: BoardAxis) => setParam('axis', axis === 'horizon' ? null : axis, 'push'),
    setQuery: (q: string) => setParam('q', q || null, 'replace'),
    setPriority: (priority: NotePriority[]) =>
      setParam('priority', priority.length ? priority.join(',') : null, 'push'),
    setMine: (mine: boolean) => setParam('mine', mine ? '1' : null, 'push'),
    setDone: (done: boolean) => setParam('done', done ? null : '0', 'push'),
    setFieldKey: (key: string | null) => {
      // Clearing the key must clear the value too, or a stale value silently narrows the
      // next property the user picks.
      setParam('fieldValue', null, 'push');
      setParam('field', key, 'push');
    },
    setFieldValue: (value: string | null) => setParam('fieldValue', value, 'push'),
    openNote: (noteId: string | null) => setParam('note', noteId, 'push'),
  };
}
