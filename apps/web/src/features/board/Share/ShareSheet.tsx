import { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { WHITEBOARD_ROLE_LABELS, whiteboardRoleValues, type WhiteboardRole } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { useMembers } from '../hooks/useMembers';
import { useShareLink } from '../hooks/useShareLink';
import { useCreateOrUpdateShareLink } from '../hooks/mutations/useShareLinkMutations';
import { MemberList } from './MemberList';
import { InviteByEmailForm } from './InviteByEmailForm';

interface ShareSheetProps {
  boardId: string;
  ownerId: string;
  isOwner: boolean;
  isBelowTablet: boolean;
}

function ShareBody({ boardId, ownerId, isOwner }: { boardId: string; ownerId: string; isOwner: boolean }) {
  const { data: members = [], isLoading: membersLoading } = useMembers(boardId);
  const shareLinkQuery = useShareLink(boardId, isOwner);
  const createOrUpdateShareLink = useCreateOrUpdateShareLink(boardId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Ensure a link exists (create with the default VIEW role) the first time an owner opens the sheet.
    if (isOwner && shareLinkQuery.isError) {
      createOrUpdateShareLink.mutate('VIEW');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, shareLinkQuery.isError]);

  async function handleCopy() {
    const link = shareLinkQuery.data;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (permissions, insecure context); the link text
      // is still visible and selectable, so this fails silently rather than blocking.
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="font-head text-15 font-bold text-fg-1">Wand teilen</p>

      {isOwner && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-inset px-3 py-2">
            {shareLinkQuery.data ? (
              <span className="min-w-0 flex-1 truncate text-12 text-fg-2">{shareLinkQuery.data.url}</span>
            ) : (
              <Skeleton className="h-4 flex-1" />
            )}
            <Button variant="link" size="text" onClick={handleCopy} disabled={!shareLinkQuery.data} className="shrink-0 text-12 font-semibold">
              {copied ? 'Kopiert' : 'Kopieren'}
            </Button>
          </div>

          <Segmented
            aria-label="Rolle für den Link"
            className="w-full"
            value={shareLinkQuery.data?.role ?? 'VIEW'}
            onChange={(role) => createOrUpdateShareLink.mutate(role as WhiteboardRole)}
            options={whiteboardRoleValues.map((role) => ({ value: role, label: WHITEBOARD_ROLE_LABELS[role] }))}
          />

          <p className="text-12 leading-relaxed text-fg-muted">
            {shareLinkQuery.data?.role === 'EDIT'
              ? 'Jeder mit dem Link kann Notizen anlegen und verschieben.'
              : 'Jeder mit dem Link kann die Wand ansehen.'}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
        <p className="text-12 font-medium text-fg-muted">Mitglieder</p>
        {membersLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <MemberList boardId={boardId} members={members} ownerId={ownerId} isOwner={isOwner} />
        )}
      </div>

      {isOwner ? (
        <div className="border-t border-border-subtle pt-4">
          <InviteByEmailForm boardId={boardId} />
        </div>
      ) : (
        <p className="text-12 text-fg-muted">Nur der Eigentümer kann Freigaben verwalten.</p>
      )}
    </div>
  );
}

export function ShareSheet({ boardId, ownerId, isOwner, isBelowTablet }: ShareSheetProps) {
  const [open, setOpen] = useState(false);

  const trigger = (
    <Button variant="ghost" size="sm" className="gap-1.5 text-fg-muted">
      <Share2 className="h-3.5 w-3.5" />
      Teilen
    </Button>
  );

  if (isBelowTablet) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85vh]">
          <SheetHeader className="border-0 p-0 pb-4">
            <SheetTitle className="sr-only">Wand teilen</SheetTitle>
          </SheetHeader>
          <div className="wally-scroll overflow-y-auto px-1 pb-4">
            <ShareBody boardId={boardId} ownerId={ownerId} isOwner={isOwner} />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[372px]">
        <ShareBody boardId={boardId} ownerId={ownerId} isOwner={isOwner} />
      </PopoverContent>
    </Popover>
  );
}
