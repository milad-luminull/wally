import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveMembers } from '../hooks/useMembers';
import { useEnumLabels } from '@/i18n/enumLabels';
import { initialsOf } from '../util/noteDerived';

/** Board membership, not live presence. Pending invitations stay in sharing settings. */
export function BoardContributors({ boardId }: { boardId: string }) {
  const { t } = useTranslation();
  const { effectiveRole } = useEnumLabels();
  const { activeMembers, isLoading, isError, refetch } = useActiveMembers(boardId);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="board-contributors"
          aria-label={t('share.peopleAria', { count: activeMembers.length })}
        >
          <span className="board-contributor-avatars" aria-hidden>
            {activeMembers.slice(0, 3).map((member) => (
              <Avatar key={member.id} className="h-6 w-6 ring-2 ring-surface">
                <AvatarFallback>{initialsOf(member.displayName ?? member.email)}</AvatarFallback>
              </Avatar>
            ))}
            {activeMembers.length > 3 && (
              <span className="board-contributor-overflow">+{activeMembers.length - 3}</span>
            )}
          </span>
          <Users className="board-contributor-mobile h-4 w-4" aria-hidden />
          <span className="board-contributor-count text-12 tabular-nums text-fg-3">
            {isLoading ? '…' : activeMembers.length}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={t('share.peopleTitle')}
        className="z-overlay max-h-[70dvh] w-80 max-w-[calc(100vw-24px)] overflow-y-auto"
      >
        <h2 className="text-14 font-medium">{t('share.peopleTitle')}</h2>
        <p className="mb-3 mt-1 text-12 text-fg-3">{t('share.peopleHint')}</p>
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : isError ? (
          <div role="alert" className="text-13 text-fg-3">
            {t('share.membersFailed')}
            <Button variant="ghost" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {activeMembers.map((member) => (
              <li key={member.id} className="flex items-center gap-2.5">
                <Avatar className="h-7 w-7 shrink-0">
                  <AvatarFallback>{initialsOf(member.displayName ?? member.email)}</AvatarFallback>
                </Avatar>
                <span
                  className="min-w-0 flex-1 truncate text-13"
                  title={member.displayName ?? member.email}
                >
                  {member.displayName ?? member.email}
                </span>
                <span className="shrink-0 text-12 text-fg-3">{effectiveRole[member.role]}</span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
