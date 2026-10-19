import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import type { CaptureParse } from '@/lib/capture/parseCapture';

/*
 * The pieces of the capture card's writing field, shared with the in-place editor of a note
 * (the smarter-capture spec, revision "editing the text asks again"): one way to write words,
 * whether the note is new or not.
 */

/** The field and its mirror: the textarea draws the caret and takes input; the div behind it draws the same text with the matches underlined. */
export const MirroredField = forwardRef<
  HTMLTextAreaElement,
  { value: string; parse: CaptureParse | null } & TextareaHTMLAttributes<HTMLTextAreaElement>
>(function MirroredField({ value, parse, ...props }, ref) {
  const matches = parse
    ? [parse.dueDate, parse.assignee, parse.priority]
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => a.start - b.start)
    : [];
  const pieces: { text: string; mark: boolean }[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue;
    if (m.start > cursor) pieces.push({ text: value.slice(cursor, m.start), mark: false });
    pieces.push({ text: value.slice(m.start, m.end), mark: true });
    cursor = m.end;
  }
  if (cursor < value.length) pieces.push({ text: value.slice(cursor), mark: false });
  const shared = 'whitespace-pre-wrap break-words text-14 font-medium leading-snug';
  return (
    <div className="relative">
      <div aria-hidden className={cn(shared, 'pointer-events-none absolute inset-0 text-fg-1')}>
        {pieces.map((p, i) =>
          p.mark ? (
            <span
              key={i}
              data-testid="capture-mark"
              className="underline decoration-fg-3 decoration-dotted underline-offset-2"
            >
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
        {value.endsWith('\n') && <br />}
      </div>
      <textarea
        {...props}
        ref={ref}
        value={value}
        rows={1}
        className={cn(
          shared,
          'relative block w-full resize-none overflow-hidden bg-transparent text-transparent caret-fg-1 outline-none placeholder:text-fg-faint',
        )}
      />
    </div>
  );
});
