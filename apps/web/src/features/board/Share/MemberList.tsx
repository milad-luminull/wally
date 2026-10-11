import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { whiteboardRoleValues, type MemberDto, type WhiteboardRole } from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IconTooltip } from '@/components/ui/tooltip';
import { initialsOf } from '../util/noteDerived';
import { useUpdateMemberRole } from '../hooks/mutations/useUpdateMemberRole';
import { useRemoveMember } from '../hooks/mutations/useRemoveMember';

interface MemberListProps {
  boardId: string;
  members: MemberDto[];
  ownerId: string;
  isOwner: boolean;
}

/** Shows both ACTIVE members and PENDING invites (see queryKeys.invites' doc comment —
 * both statuses live in the one members list). Owner-only role/remove controls per
 * SPEC §9. */
export function MemberList({ boardId, members, ownerId, isOwner }: MemberListProps) {
  const { t } = useTranslation();
  const { effectiveRole, whiteboardRole } = useEnumLabels();
  const updateRole = useUpdateMemberRole(boardId);
  const removeMember = useRemoveMember(boardId);

  return (
    <div className="flex flex-col gap-3">
      {members.map((member) => {
        const name = member.displayName ?? member.email;
        const isBoardOwner = member.userId === ownerId;
        return (
          <div key={member.id} className="flex items-center gap-2.5">
            <Avatar>
              <AvatarFallback>{initialsOf(name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-14 font-medium text-fg-1">{name}</div>
              {member.status === 'PENDING' && (
                <div className="text-12 text-fg-muted">{t('share.members.pending')}</div>
              )}
            </div>
            {isOwner && !isBoardOwner ? (
              <>
                {/* Only reachable for non-owner rows, so member.role is VIEW|EDIT here even
                    though MemberDto.role also admits the synthetic owner's OWNER. */}
                <Select
                  value={member.role}
                  onValueChange={(role) =>
                    updateRole.mutate({ memberId: member.id, role: role as WhiteboardRole })
                  }
                >
                  <SelectTrigger
                    aria-label={t('share.members.roleAria', { name })}
                    className="h-8 w-[104px] shrink-0 rounded-md border border-border bg-card px-2.5 text-12"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {whiteboardRoleValues.map((r) => (
                      <SelectItem key={r} value={r}>
                        {whiteboardRole[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <IconTooltip label={t('share.members.remove', { name })}>
                  <button
                    type="button"
                    onClick={() => removeMember.mutate(member.id)}
                    aria-label={t('share.members.remove', { name })}
                    className="p-1 text-fg-faint transition-colors hover:text-status-danger"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </IconTooltip>
              </>
            ) : (
              <span className="whitespace-nowrap text-12 text-fg-muted">
                {effectiveRole[member.role]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
