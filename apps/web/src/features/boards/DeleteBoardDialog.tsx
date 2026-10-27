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
import { useBoard } from '@/features/board/hooks/useBoard';
import { useNotes } from '@/features/board/hooks/useNotes';
import { useDeleteBoard } from '@/features/board/hooks/mutations/useDeleteBoard';

/**
 * The one confirmation in the app (RFC-0002 §9): deleting a board takes every note and
 * every member's access with it, so it names the board and how many notes go. Undo, as notes
 * have, is not possible here — members lose access at once.
 */
export function DeleteBoardDialog({
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
  // Primes the board's revision, which the delete is checked against.
  useBoard(open ? board.id : undefined);
  const notes = useNotes(open ? board.id : undefined);
  const deleteBoard = useDeleteBoard(board.id);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus(confirmed.current);
        }}
      >
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
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              confirmed.current = true;
              deleteBoard.mutate();
            }}
          >
            {t('home.delete.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
