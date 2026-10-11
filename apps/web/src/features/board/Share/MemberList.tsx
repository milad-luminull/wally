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
import { RemoveButton } from '@/components/ui/remove-button';
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
  const { removeMember } = useRemoveMember(boardId);

  return (
    <div className="-mx-1.5 flex flex-col">
      {members.map((member) => {
        const name = member.displayName ?? member.email;
        const isBoardOwner = member.userId === ownerId;
        return (
          <div
            key={member.id}
            className="flex min-h-10 items-center gap-2.5 rounded-md px-1.5 hover:bg-surface-alt"
          >
            <Avatar className="h-7 w-7">
              <AvatarFallback>{initialsOf(name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-13 font-medium text-fg-1">{name}</div>
              {member.status === 'PENDING' && (
                <div className="text-12 text-fg-3">{t('share.members.pending')}</div>
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
                    className="h-7 w-[104px] shrink-0 text-12 shadow-none"
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
                  <RemoveButton
                    label={t('share.members.remove', { name })}
                    onClick={() => removeMember(member)}
                  />
                </IconTooltip>
              </>
            ) : (
              <span className="whitespace-nowrap pr-1 text-12 text-fg-3">
                {effectiveRole[member.role]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
