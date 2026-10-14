import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

/** The lock on a private note. A native title, not a Tooltip: the card and the row are
 *  buttons themselves and cannot host a second interactive trigger. */
export function PrivateBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  const label = t('note.private.badge');
  return (
    <span role="img" aria-label={label} title={label} className={cn('flex shrink-0', className)}>
      <Lock aria-hidden className="h-3 w-3" strokeWidth={1.9} />
    </span>
  );
}
