import { useTranslation } from 'react-i18next';
import type { NoteDto } from '@wally/shared';
import { Button } from '@/components/ui/button';
import type { PendingProps } from '../Suggestions/pendingProps';
import { ProposalList } from '../Suggestions/ProposalList';
import { FieldLabel, PanelSection } from './Field';

interface PendingReviewProps {
  note: NoteDto;
  pending: PendingProps;
}

/**
 * The note panel's review of a pending change: the same rows as the card (Paper Wall v3), a
 * line that says whether the change is about to be kept, and Keep and Discard; once kept, only
 * Undo. Keep and Undo are the same button, so the keyboard stays on it across a keep.
 */
export function PendingReview({ note, pending }: PendingReviewProps) {
  const { t } = useTranslation();
  const { mark } = pending;
  const kept = mark.phase === 'kept';
  // A countdown paused by this panel being open still runs once it closes.
  const countsDown = mark.countdownEndsAt !== null || mark.paused;
  const status = kept
    ? t('suggest.review.kept')
    : countsDown
      ? t('suggest.review.counting')
      : t('suggest.review.waiting');

  return (
    <PanelSection>
      <div data-pending-review className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <FieldLabel>{t('suggest.review.label')}</FieldLabel>
          <p role="status" className="text-12 leading-snug text-fg-3">
            {status}
          </p>
        </div>

        {/* The same rows as the card and the list row (Paper Wall v3), so the panel and the
            card never disagree. */}
        {mark.phase === 'pending' && <ProposalList note={note} pending={pending} />}

        <div className="flex items-center gap-1.5">
          {/* One button that is Keep and then Undo: the same element, so the keyboard stays on
              it when the change is kept. Ink, not marigold: the board's "New note" is the
              screen's one accent, and marigold is the dot's alone here (BRAND, "Marigold has
              four jobs"). With everything crossed out, Keep discards. */}
          <Button
            key="primary"
            variant={kept ? 'ghost' : 'default'}
            size="sm"
            onClick={() => (kept ? pending.onUndo('click') : pending.onKeep('click'))}
          >
            {kept ? t('suggest.review.undo') : t('suggest.review.keep')}
          </Button>
          {!kept && (
            <Button key="discard" variant="ghost" size="sm" onClick={pending.onDiscard}>
              {t('suggest.review.discard')}
            </Button>
          )}
        </div>
      </div>
    </PanelSection>
  );
}
