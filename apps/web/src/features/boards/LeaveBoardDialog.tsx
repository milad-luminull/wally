import { useRef } from 'react';
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
  onRestoreFocus,
}: {
  board: WhiteboardSummaryDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes on close: the opener is gone after a confirmation. */
  onRestoreFocus: (confirmed: boolean) => void;
}) {
  const confirmed = useRef(false);
  const { t } = useTranslation();
  const leaveBoard = useLeaveBoard(board.id);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus(confirmed.current);
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('home.leave.title', { name: board.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('home.leave.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              confirmed.current = true;
              leaveBoard.mutate();
            }}
          >
            {t('home.leave.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
