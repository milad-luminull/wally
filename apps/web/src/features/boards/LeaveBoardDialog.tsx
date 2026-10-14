import { useTranslation } from 'react-i18next';
import type { WhiteboardSummaryDto } from '@wally/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useLeaveBoard } from '@/features/board/hooks/mutations/useLeaveBoard';

/** Leaving cannot be undone by the member alone: they need a new invitation (RFC §10). */
export function LeaveBoardDialog({
  board,
  open,
  onOpenChange,
}: {
  board: WhiteboardSummaryDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const leaveBoard = useLeaveBoard(board.id);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('home.leave.title', { name: board.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('home.leave.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => leaveBoard.mutate()}>
            {t('home.leave.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
