import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WhiteboardDto, WhiteboardSummaryDto } from '@wally/shared';
import { useSessionMutation as useMutation } from '@/lib/useSessionMutation';
import { captureMutation, isCurrentSession, type MutationTicket } from '@/lib/mutationQueue';
import type { ApiError } from '@/lib/apiClient';
import { boardsApi } from '@/lib/resources';
import { useQueryKeys } from '../queryKeys';

/**
 * Creates a board the caller owns (RFC-0002 §8). The dialog shows its own errors, so the
 * global failure toast is silenced.
 *
 * The operation id is kept while the typed name stays the same: pressing Create again after a
 * lost response replays the first request and returns the same board instead of a second one.
 * A different name is a different request and gets a new id.
 */
export function useCreateBoard() {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const attempt = useRef<{ name: string; ticket: MutationTicket } | null>(null);

  return useMutation<WhiteboardDto, ApiError, { name: string }>({
    meta: { silentError: true },
    mutationFn: ({ name }) => {
      const reuse =
        attempt.current?.name === name && isCurrentSession(attempt.current.ticket.generation);
      if (!reuse)
        attempt.current = { name, ticket: captureMutation(`create:${crypto.randomUUID()}`) };
      return boardsApi.create(name, attempt.current!.ticket);
    },
    onSuccess: (board) => {
      attempt.current = null;
      const summary: WhiteboardSummaryDto = {
        id: board.id,
        name: board.name,
        currentUserRole: board.currentUserRole,
      };
      queryClient.setQueryData<WhiteboardSummaryDto[]>(keys.meBoards(), (list) =>
        list && !list.some((item) => item.id === board.id) ? [...list, summary] : list,
      );
      // The app navigates straight into the new board; this spares it a loading flash.
      queryClient.setQueryData(keys.board(board.id), board);
      void queryClient.invalidateQueries({ queryKey: keys.meBoards(), exact: true });
    },
  });
}
