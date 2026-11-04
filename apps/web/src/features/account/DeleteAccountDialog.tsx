import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { MemberDto } from '@wally/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBoards } from '@/features/board/hooks/useBoards';
import { useQueryKeys } from '@/features/board/hooks/queryKeys';
import { api } from '@/lib/apiClient';
import { membersApi } from '@/lib/resources';

/** Set just before signing out after a deletion, so /login can say the account is gone. */
export const ACCOUNT_DELETED_FLAG = 'wally.accountDeleted';

const nameOf = (member: MemberDto) => member.displayName ?? member.email;

/**
 * Deletes the signed-in account (the account deletion design). It lists the boards that go
 * for everyone, with who else is on them, and unlocks only when the account's email is typed.
 * The server erases at once; on success the session ends and /login confirms it.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const boards = useBoards();
  const owned = (boards.data ?? []).filter((board) => board.currentUserRole === 'OWNER');
  const members = useQueries({
    queries: owned.map((board) => ({
      queryKey: keys.members(board.id),
      queryFn: () => membersApi.list(board.id),
      enabled: open,
    })),
  });

  // The list is the safeguard: nothing can be deleted before it is complete.
  const listReady = boards.isSuccess && members.every((query) => query.isSuccess);
  const listFailed = boards.isError || members.some((query) => query.isError);

  const email = user?.email ?? '';
  const matches = email !== '' && typed.trim().toLowerCase() === email.toLowerCase();

  async function confirm() {
    setPending(true);
    setFailed(false);
    try {
      await api.delete('/me');
    } catch {
      setFailed(true);
      setPending(false);
      return;
    }
    try {
      sessionStorage.setItem(ACCOUNT_DELETED_FLAG, '1');
    } catch {
      /* Storage blocked: the message is a courtesy. */
    }
    // Nothing may refetch with the old token on the way out.
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOut();
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('accountData.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('accountData.deleteHint')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 text-14">
          {listFailed ? (
            <p role="alert" className="text-status-danger">
              {t('accountData.deleteListFailed')}
            </p>
          ) : !listReady ? (
            <p>{t('accountData.deleteLoading')}</p>
          ) : owned.length ? (
            <div className="space-y-1">
              <p>{t('accountData.deleteBoards')}</p>
              <ul className="list-disc space-y-1 pl-5">
                {owned.map((board, index) => {
                  const others = (members[index]?.data ?? []).filter((m) => m.role !== 'OWNER');
                  return (
                    <li key={board.id}>
                      {others.length
                        ? `${board.name} — ${t('accountData.deleteSharedWith', {
                            names: others.map(nameOf).join(', '),
                          })}`
                        : board.name}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p>{t('accountData.deleteNoBoards')}</p>
          )}
          <p>{t('accountData.deleteNotes')}</p>
          <div className="space-y-1">
            <Label htmlFor={inputId}>{t('accountData.deleteTypeEmail', { email })}</Label>
            <Input
              id={inputId}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          {failed && (
            <p role="alert" className="text-status-danger">
              {t('accountData.deleteFailed')}
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('common.cancel')}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!matches || pending || !listReady}
            onClick={confirm}
          >
            {t('accountData.deleteConfirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
