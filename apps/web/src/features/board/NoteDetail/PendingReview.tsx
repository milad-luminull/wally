import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteDto } from '@wally/shared';
import { cn } from '@/lib/cn';
import type { PendingProps } from '../Suggestions/pendingProps';
import { ProposalList } from '../Suggestions/ProposalList';
import { ReviewFooter } from '../Suggestions/ReviewFooter';
import { footerAction } from '../Suggestions/footerAction';
import { PanelSection } from './Field';

interface PendingReviewProps {
  note: NoteDto;
  pending: PendingProps;
}

/**
 * The note panel's review of a change, drawn as the card draws it (the smarter-capture spec,
 * revision "editing the text asks again": one look): inside the moving border, "Filling in"
 * while the call runs, then the same rows and the same footer (ring, seconds or Paused, Undo,
 * Keep). Once kept, the border goes and only Undo stays, as the card's corner does. A keep
 * pressed from the keyboard hands the focus to that Undo, so the keyboard is never dropped.
 */
export function PendingReview({ note, pending }: PendingReviewProps) {
  const { t } = useTranslation();
  const { mark } = pending;
  const kept = mark.phase === 'kept';
  /** Whether Keep held the focus last: then the kept Undo takes it over. */
  const keepHadFocus = useRef(false);
  const undoRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!kept) return;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (keepHadFocus.current && lost) undoRef.current?.focus({ preventScroll: true });
    keepHadFocus.current = false;
  }, [kept]);

  if (kept)
    return (
      <PanelSection>
        <div data-pending-review className="flex items-center gap-2">
          <p role="status" className="min-w-0 flex-1 text-12 text-fg-meta-on-note">
            {t('suggest.review.kept')}
          </p>
          <span
            ref={undoRef}
            role="button"
            tabIndex={0}
            onClick={() => pending.onUndo('click')}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              pending.onUndo('click');
            }}
            className={cn(
              footerAction,
              'border border-[color:var(--note-border)] text-fg-1 hover:bg-inset-hover',
            )}
          >
            {t('suggest.undo')}
          </span>
        </div>
      </PanelSection>
    );

  return (
    <PanelSection>
      <div
        data-pending-review
        data-capture-card
        className="capture-glow"
        onFocusCapture={(e) => {
          keepHadFocus.current =
            e.target instanceof Element && e.target.closest('[data-review-keep]') !== null;
        }}
      >
        <div className="flex flex-col gap-2 rounded-[11px] bg-surface px-3.5 py-3">
          {mark.phase === 'pending' && <ProposalList note={note} pending={pending} />}
          <ReviewFooter
            mark={mark}
            onKeep={() => pending.onKeep('click')}
            onUndo={pending.onDiscard}
            onRetry={pending.onRetry}
            onDismiss={pending.onDismiss}
          />
        </div>
      </div>
    </PanelSection>
  );
}
