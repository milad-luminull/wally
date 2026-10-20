import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useMembers } from '../hooks/useMembers';
import { useOpenRequest } from '@/lib/shortcuts';
import { MemberList } from './MemberList';
import { InviteByEmailForm } from './InviteByEmailForm';
import { ShareLinkControls } from './ShareLinkControls';

interface ShareSheetProps {
  boardId: string;
  boardName: string;
  ownerId: string;
  isOwner: boolean;
  isBelowTablet: boolean;
  triggerClassName?: string;
}

function ShareBody({
  boardId,
  boardName,
  ownerId,
  isOwner,
}: Omit<ShareSheetProps, 'isBelowTablet'>) {
  const membersQuery = useMembers(boardId);
  const { data: members = [], isLoading, isError, refetch } = membersQuery;
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="break-words text-16 font-semibold text-fg-1">
          {t('share.title', { name: boardName })}
        </h2>
        <p className="mt-2 text-12 leading-relaxed text-fg-3">{t('share.scopeHint')}</p>
      </div>
      {isOwner && <InviteByEmailForm boardId={boardId} boardName={boardName} />}
      <section className="flex flex-col gap-2" aria-label={t('share.membersHeading')}>
        <h3 className="text-12 font-medium text-fg-3">{t('share.membersHeading')}</h3>
        {isLoading ? (
          <div className="flex flex-col gap-2 py-1" role="status" aria-label={t('common.loading')}>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : isError && !membersQuery.data ? (
          <div role="alert" className="text-13 text-fg-3">
            {t('share.membersFailed')}
            <Button variant="ghost" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <MemberList boardId={boardId} members={members} ownerId={ownerId} isOwner={isOwner} />
        )}
        {isError && membersQuery.data && (
          <div role="alert" className="text-13 text-fg-3">
            {t('share.membersFailed')}
            <Button variant="ghost" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        )}
      </section>
      <p className="text-12 text-fg-3">{t('share.privateNotesHint')}</p>
      {isOwner ? (
        <ShareLinkControls boardId={boardId} />
      ) : (
        <p className="text-12 text-fg-3">{t('share.ownerOnly')}</p>
      )}
    </div>
  );
}

export function ShareSheet({
  boardId,
  boardName,
  ownerId,
  isOwner,
  isBelowTablet,
  triggerClassName,
}: ShareSheetProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useOpenRequest('share', () => setOpen(true));
  const trigger = (
    <Button variant="outline" aria-label={t('share.trigger')} className={triggerClassName}>
      <UserPlus strokeWidth={1.75} />
      <span className="hidden sm:inline">{t('share.trigger')}</span>
    </Button>
  );
  const body = (
    <ShareBody boardId={boardId} boardName={boardName} ownerId={ownerId} isOwner={isOwner} />
  );
  if (isBelowTablet) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85dvh]">
          <SheetHeader className="border-0 p-0">
            <SheetTitle className="sr-only">{t('share.title', { name: boardName })}</SheetTitle>
          </SheetHeader>
          <div className="wally-scroll overflow-y-auto p-4">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        aria-label={t('share.title', { name: boardName })}
        className="z-overlay max-h-[85dvh] w-[440px] max-w-[calc(100vw-24px)] overflow-y-auto"
      >
        {body}
      </PopoverContent>
    </Popover>
  );
}
