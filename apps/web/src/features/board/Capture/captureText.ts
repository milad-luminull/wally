import type { CaptureParse } from '@/lib/capture/parseCapture';
import type { ChipState } from './CaptureChips';

/** Helpers of the writing field, shared by the capture card and the in-place editor. */

/** The parse without the matches whose chips were dropped, so their words lose the underline. */
export function withoutDropped(parse: CaptureParse | null, chips: ChipState): CaptureParse | null {
  if (!parse) return null;
  return {
    dueDate: chips.dropped.dueDate ? null : parse.dueDate,
    assignee: chips.dropped.assignee ? null : parse.assignee,
    priority: chips.dropped.priority ? null : parse.priority,
  };
}

/** Grows a textarea to its content, so the card expands in place instead of scrolling. */
export function fitToContent(field: HTMLTextAreaElement | null) {
  if (!field) return;
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight}px`;
}

/** The schema keeps a description as typed; only whitespace alone counts as no text. */
export function asTyped(text: string): string {
  return text.trim() ? text : '';
}
