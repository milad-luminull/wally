import type { UserSummary } from '@wally/shared';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import { displayName, initialsOf } from './util/noteDerived';

interface AssigneeAvatarProps {
  user: UserSummary;
  /** The note is assigned to whoever is looking at it. */
  isYou: boolean;
  size?: 'xs' | 'sm';
  className?: string;
}

/**
 * Who a note belongs to, as initials.
 *
 * Your own notes are drawn hollow — a primary ring on a surface fill — rather than being
 * left off. The card used to hide your own avatar, which made "assigned to me" look exactly
 * like "assigned to nobody".
 */
export function AssigneeAvatar({ user, isYou, size = 'xs', className }: AssigneeAvatarProps) {
  const { t } = useTranslation();
  const name = displayName(user);
  const label = isYou ? t('note.assignedToYou') : t('note.assignedTo', { name });

  return (
    <Avatar
      title={isYou ? t('common.you') : name}
      className={cn(size === 'xs' ? 'h-5 w-5' : 'h-[18px] w-[18px]', className)}
    >
      <AvatarFallback
        aria-hidden
        className={cn(
          'text-[10px] font-semibold',
          size === 'sm' && 'text-[9px]',
          isYou
            ? 'bg-surface text-primary ring-[1.5px] ring-inset ring-primary'
            : 'bg-primary text-primary-foreground',
        )}
      >
        {initialsOf(name)}
      </AvatarFallback>
      <span className="sr-only">{label}</span>
    </Avatar>
  );
}
