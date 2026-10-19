import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * The notes did not load: said as such, with Try again, never drawn as an empty board (the
 * error handling spec, 2026-10-19).
 */
export function BoardLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-1 items-center justify-center">
      <EmptyState
        title={t('errors.notesFailed.title')}
        hint={t('errors.notesFailed.hint')}
        action={
          <Button size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        }
      />
    </div>
  );
}
