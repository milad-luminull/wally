import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Link2, UserPlus } from 'lucide-react';
import { whiteboardRoleValues, type WhiteboardRole } from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useMembers } from '../hooks/useMembers';
import { useShareLink } from '../hooks/useShareLink';
import { useCreateOrUpdateShareLink } from '../hooks/mutations/useShareLinkMutations';
import { useOpenRequest } from '@/lib/shortcuts';
import { MemberList } from './MemberList';
import { InviteByEmailForm } from './InviteByEmailForm';

interface ShareSheetProps {
  boardId: string;
  ownerId: string;
  isOwner: boolean;
  isBelowTablet: boolean;
  /** Extra classes for the trigger, for the top bar's phone-width padding. */
  triggerClassName?: string;
}

function ShareBody({
  boardId,
  ownerId,
  isOwner,
}: {
  boardId: string;
  ownerId: string;
  isOwner: boolean;
}) {
  const membersQuery = useMembers(boardId);
  const { data: members = [], isLoading: membersLoading } = membersQuery;
  const { t } = useTranslation();
  const { whiteboardRole } = useEnumLabels();
  const shareLinkQuery = useShareLink(boardId, isOwner);
  const createOrUpdateShareLink = useCreateOrUpdateShareLink(boardId);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // No link yet is a 404: the first owner to open the sheet makes one. Any other failure is
  // said, with Try again; it never makes a second link.
  const linkMissing =
    shareLinkQuery.isError && (shareLinkQuery.error as { status?: unknown } | null)?.status === 404;
  const linkFailed = shareLinkQuery.isError && !linkMissing;

  useEffect(() => {
    // Ensure a link exists (create with the default VIEW role) the first time an owner opens the sheet.
    if (isOwner && linkMissing) {
      createOrUpdateShareLink.mutate('VIEW');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, linkMissing]);

  async function handleCopy() {
    const link = shareLinkQuery.data;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (permissions, insecure context): the link text is
      // still there to select, and the sheet says so.
      setCopyFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-14 font-medium text-fg-1">{t('share.title')}</p>

      {/* Inviting a person is the common case, so it leads. */}
      {isOwner && <InviteByEmailForm boardId={boardId} />}

      <div className="flex flex-col gap-1">
        <p className="text-12 font-medium text-fg-3">{t('share.membersHeading')}</p>
        {membersQuery.isError && !membersQuery.data ? (
          <div role="alert" className="flex items-center gap-2 py-1 text-13 text-fg-2">
            <span className="flex-1">{t('share.membersFailed')}</span>
            <Button size="sm" variant="ghost" onClick={() => void membersQuery.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : membersLoading ? (
          <div className="flex flex-col gap-2 py-1" role="status" aria-label={t('common.loading')}>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <MemberList boardId={boardId} members={members} ownerId={ownerId} isOwner={isOwner} />
        )}
      </div>
      <p className="text-12 text-fg-3">{t('share.privateNotesHint')}</p>

      {isOwner ? (
        <div className="-mx-4 -mb-4 flex flex-col gap-2 border-t border-border-subtle bg-surface-alt px-4 py-3">
          <div className="flex items-center gap-2">
            <Link2 aria-hidden className="h-4 w-4 shrink-0 text-fg-3" strokeWidth={1.75} />
            <p className="min-w-0 flex-1 text-13 text-fg-1">{t('share.linkLabel')}</p>
            <Select
              value={shareLinkQuery.data?.role ?? 'VIEW'}
              onValueChange={(role) => createOrUpdateShareLink.mutate(role as WhiteboardRole)}
            >
              <SelectTrigger aria-label={t('share.linkRoleAria')} className="h-7 w-[112px] text-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {whiteboardRoleValues.map((role) => (
                  <SelectItem key={role} value={role}>
                    {whiteboardRole[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-border bg-surface px-2.5">
              {shareLinkQuery.data ? (
                <span className="min-w-0 flex-1 truncate font-mono text-12 text-fg-2">
                  {shareLinkQuery.data.url}
                </span>
              ) : linkFailed ? (
                <span
                  role="alert"
                  className="flex min-w-0 flex-1 items-center gap-2 text-12 text-fg-2"
                >
                  <span className="flex-1 truncate">{t('share.linkFailed')}</span>
                  <button
                    type="button"
                    className="font-medium text-fg-1 underline-offset-2 hover:underline"
                    onClick={() => void shareLinkQuery.refetch()}
                  >
                    {t('common.retry')}
                  </button>
                </span>
              ) : (
                <Skeleton className="h-3.5 flex-1" />
              )}
            </div>
            <Button
              variant="outline"
              onClick={handleCopy}
              disabled={!shareLinkQuery.data}
              className="w-[96px] shrink-0"
            >
              {copied ? <Check strokeWidth={2} /> : <Copy strokeWidth={1.75} />}
              {copied ? t('share.copied') : t('share.copy')}
            </Button>
          </div>
          {copyFailed && (
            <p role="alert" className="text-12 text-fg-2">
              {t('share.copyFailed')}
            </p>
          )}
          <p className="text-12 text-fg-3">
            {shareLinkQuery.data?.role === 'EDIT'
              ? t('share.linkHint.EDIT')
              : t('share.linkHint.VIEW')}
          </p>
        </div>
      ) : (
        <p className="text-12 text-fg-3">{t('share.ownerOnly')}</p>
      )}
    </div>
  );
}

export function ShareSheet({
  boardId,
  ownerId,
  isOwner,
  isBelowTablet,
  triggerClassName,
}: ShareSheetProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // The command palette's "Share board" lands here.
  useOpenRequest('share', () => setOpen(true));

  const trigger = (
    <Button variant="outline" aria-label={t('share.trigger')} className={triggerClassName}>
      <UserPlus strokeWidth={1.75} />
      <span className="hidden sm:inline">{t('share.trigger')}</span>
    </Button>
  );

  if (isBelowTablet) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85vh]">
          <SheetHeader className="border-0 p-0">
            <SheetTitle className="sr-only">{t('share.title')}</SheetTitle>
          </SheetHeader>
          <div className="wally-scroll overflow-y-auto p-4">
            <ShareBody boardId={boardId} ownerId={ownerId} isOwner={isOwner} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[400px]">
        <ShareBody boardId={boardId} ownerId={ownerId} isOwner={isOwner} />
      </PopoverContent>
    </Popover>
  );
}
