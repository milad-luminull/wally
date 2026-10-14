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
import { useBoard } from '@/features/board/hooks/useBoard';
import { useNotes } from '@/features/board/hooks/useNotes';
import { useDeleteBoard } from '@/features/board/hooks/mutations/useDeleteBoard';

/**
 * The one confirmation in the app (RFC BOARD_HOME §9): deleting a board takes every note and
 * every member's access with it, so it names the board and how many notes go. Undo, as notes
 * have, is not possible here — members lose access at once.
 */
export function DeleteBoardDialog({
  board,
  open,
  onOpenChange,
}: {
  board: WhiteboardSummaryDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  // Primes the board's revision, which the delete is checked against.
  useBoard(open ? board.id : undefined);
  const notes = useNotes(open ? board.id : undefined);
  const deleteBoard = useDeleteBoard(board.id);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('home.delete.title', { name: board.name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {notes.data
              ? t('home.delete.body', { count: notes.data.length })
              : t('home.delete.bodyCounting')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => deleteBoard.mutate()}>
            {t('home.delete.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
