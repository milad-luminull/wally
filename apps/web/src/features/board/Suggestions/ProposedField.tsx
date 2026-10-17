import type { KeyboardEvent, ReactNode, SyntheticEvent } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * One proposed field in the place it has on a normal card, in the note's own type and colour
 * (BRAND rule 3), with its reason for a screen reader and an × that removes it alone (§3.3).
 *
 * The × looks like `RemoveButton` but is a `role="button"` span, not a `<button>`: on the wall
 * it sits inside the card, which is itself a `<button>`, and HTML allows no button inside a
 * button. Every press on it stops here, so it never opens the note, starts a drag (dnd-kit
 * listens for pointer and key events on the card) or keeps the whole change on Enter.
 */
export function ProposedField({
  label,
  name,
  reason,
  onRemove,
  className,
}: {
  label: ReactNode;
  name: string;
  reason: string;
  onRemove: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    onRemove();
  }
  return (
    <span
      data-proposed={name}
      className={cn('inline-flex items-center gap-0.5', className)}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
    >
      <span title={t('suggest.reason', { reason })}>{label}</span>
      <span
        role="button"
        tabIndex={0}
        aria-label={t('suggest.remove', { label: name })}
        onClick={onRemove}
        onKeyDown={onKeyDown}
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
