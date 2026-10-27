import { useEffect, useRef, type FocusEvent } from 'react';
import type { PendingProps } from './pendingProps';

/**
 * The hover and focus handlers that pause a pending countdown (RFC-0005-wallybot-inline.md §3.3:
 * "pauses on hover or focus"). Hover and focus are tracked apart and the card or row reports
 * `hovered || focused`, so the pointer leaving a focused card, or focus leaving a hovered one,
 * does not resume the countdown while the other still holds. Focus moving between the root
 * and a control inside it (an ×, the checkbox) counts as staying focused.
 *
 * Hover always pauses. Focus pauses only when it arrives once the change is pending: the
 * board focuses the committed card itself while the mark is still asking (useCaptureSession),
 * and that focus is not the person's. So when the mark turns pending, focus starts over as
 * "not focused", and a pointer already on the card pauses at once. A card that unmounts while
 * it holds the pause lets go of it.
 */
export function usePendingPause(pending: PendingProps | undefined, held = false) {
  const hovered = useRef(false);
  const focused = useRef(false);
  // The words being edited in place hold the countdown however the focus got there: an answer
  // that lands mid-edit must not count down under the person's typing.
  const holding = useRef(held);
  holding.current = held;
  const latest = useRef(pending);
  latest.current = pending;
  const phase = pending?.mark.phase;

  useEffect(() => {
    if (phase !== 'pending') return;
    focused.current = holding.current;
    if (hovered.current || holding.current) latest.current?.onPause(true);
  }, [phase]);

  // A card or row that leaves the board under the pointer or with focus (another view, a
  // filter, the note gone) gets no leave or blur: it lets go of its hold as it goes.
  useEffect(
    () => () => {
      if (hovered.current || focused.current) latest.current?.onPause(false);
    },
    [],
  );

  function set(source: 'hover' | 'focus', value: boolean) {
    const before = hovered.current || focused.current;
    (source === 'hover' ? hovered : focused).current = value;
    const after = hovered.current || focused.current;
    if (after !== before) pending?.onPause(after);
  }

  return {
    onMouseEnter: () => set('hover', true),
    onMouseLeave: () => set('hover', false),
    onFocus: () => set('focus', true),
    onBlur: (e: FocusEvent<HTMLElement>) => {
      const next = e.relatedTarget;
      if (next instanceof Node && e.currentTarget.contains(next)) return;
      set('focus', false);
    },
  };
}
