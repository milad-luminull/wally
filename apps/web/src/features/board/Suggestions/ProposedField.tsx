import type { KeyboardEvent, ReactNode, SyntheticEvent } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Enter and Space press a `role="button"` span, and go no further than it. */
const onPress = (action: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  e.stopPropagation();
  action();
};

/**
 * One proposed field in the place it has on a normal card, in the note's own type and colour
 * (BRAND rule 3), with its reason as the tooltip (none when there is no reason) and an × that
 * removes it alone (§3.3).
 * Without `onRemove` (a kept value waiting for the refetch) it is the plain value, no ×.
 *
 * The × looks like `RemoveButton` but is a `role="button"` span, not a `<button>`: on the wall
 * it sits inside the card, which is itself a `<button>`, and HTML allows no button inside a
 * button. Every press on it stops here, so it never opens the note, starts a drag (dnd-kit
 * listens for pointer and key events on the card) or keeps the whole change on Enter.
 *
 * With `toggle`, the value itself is a second `role="button"` span the person taps to take the
 * value into the change or leave it out, its state in `aria-pressed`: the offered title line,
 * which never joins the change on its own (plan R2). `toggle.description` says what a press
 * does and is given only while the value is not taken. `removeLabel` names the × when "remove
 * suggestion" is not what it does (the title's "use mine").
 */
export function ProposedField({
  label,
  name,
  reason,
  onRemove,
  toggle,
  removeLabel,
  className,
}: {
  label: ReactNode;
  name: string;
  reason: string;
  onRemove?: () => void;
  toggle?: { pressed: boolean; onToggle: () => void; description: string };
  removeLabel?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!onRemove) return <span className={cn('inline-flex items-center', className)}>{label}</span>;
  return (
    <span
      data-proposed={name}
      className={cn('inline-flex items-center gap-0.5', className)}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
    >
      {toggle ? (
        <span
          role="button"
          tabIndex={0}
          aria-pressed={toggle.pressed}
          // What a press does: only while it would take the value. Pressed, the state says it.
          aria-description={toggle.pressed ? undefined : toggle.description}
          title={reason ? t('suggest.reason', { reason }) : undefined}
          onClick={toggle.onToggle}
          onKeyDown={onPress(toggle.onToggle)}
          className={cn(
            'flex min-h-5 min-w-0 cursor-pointer items-center rounded-[3px]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
            '[@media(pointer:coarse)]:min-h-10',
          )}
        >
          {label}
        </span>
      ) : (
        <span title={reason ? t('suggest.reason', { reason }) : undefined}>{label}</span>
      )}
      <span
        role="button"
        tabIndex={0}
        aria-label={removeLabel ?? t('suggest.remove', { label: name })}
        onClick={onRemove}
        onKeyDown={onPress(onRemove)}
        className={cn(
          'flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-fg-faint',
          'transition-colors duration-100 hover:bg-inset-hover hover:text-fg-1',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
          '[@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10',
        )}
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </span>
    </span>
  );
}
