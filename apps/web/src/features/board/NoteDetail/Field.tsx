import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Shared field furniture for the note panel.
 *
 * The panel previously stacked eight identically-weighted label/control pairs at a uniform
 * gap, so nothing led and nothing grouped. `PanelSection` introduces the missing second
 * level: related fields sit together under one rule, and the labels inside a section are
 * quieter than the section itself.
 */
export function FieldLabel({
  children,
  htmlFor,
  className,
}: {
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  /* Sentence case, not uppercase: the panel already groups fields with section rules, and
   * stacking an uppercase section heading above an uppercase field label made every row
   * shout at the same volume. */
  const classes = cn('text-12 font-medium text-fg-3', className);
  return htmlFor ? (
    <label htmlFor={htmlFor} className={classes}>
      {children}
    </label>
  ) : (
    <span className={classes}>{children}</span>
  );
}

/**
 * One row of the panel's properties grid: a quiet label on the left, the control on the
 * right. The label column is fixed so every control starts on the same vertical line.
 */
export function PropertyRow({
  label,
  htmlFor,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="note-detail-property grid min-h-8 grid-cols-[88px_minmax(0,1fr)] items-center gap-3">
      <FieldLabel htmlFor={htmlFor} className="truncate">
        {label}
      </FieldLabel>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}

/** A group of related fields. The hairline rule does the grouping work, so sections carry
 * no heading of their own — the field labels inside are already the only labels needed. */
export function PanelSection({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'note-detail-section flex flex-col gap-3 border-t border-border-subtle px-5 py-4 first:border-t-0',
        className,
      )}
    >
      {children}
    </section>
  );
}
