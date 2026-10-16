import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantConversationDto } from '@wally/shared';
import { ApiError } from '@/lib/apiClient';
import { assistantApi } from '@/lib/resources';
import { useQueryKeys } from '../hooks/queryKeys';

export type RefusalCode = 'ASSISTANT_DAILY_CAP' | 'ASSISTANT_MONTHLY_CAP' | 'ASSISTANT_BUSY';
export type AskOutcome =
  | { kind: 'answered'; conversation: AssistantConversationDto }
  | { kind: 'refused'; code: RefusalCode; resetsAt: string | null }
  | { kind: 'failed' };

const REFUSALS: RefusalCode[] = ['ASSISTANT_DAILY_CAP', 'ASSISTANT_MONTHLY_CAP', 'ASSISTANT_BUSY'];

/** Today in the browser's calendar, as the API expects it; not UTC, which is a day off at night. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * One question to the board. The API's three outcomes are returned as data, never thrown,
 * so the panel renders each in the answer's place. A conversation that closed under the
 * panel is retried once without its id, which starts a new one.
 */
export function useAskAssistant(boardId: string) {
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const [isPending, setPending] = useState(false);

  const ask = useCallback(
    async (message: string, conversationId: string | null): Promise<AskOutcome> => {
      const base = {
        message,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        today: localToday(),
      };
      setPending(true);
      try {
        let response;
        try {
          response = await assistantApi.turn(
            boardId,
            conversationId ? { ...base, conversationId } : base,
          );
        } catch (error) {
          if (
            conversationId &&
            error instanceof ApiError &&
            error.status === 409 &&
            error.code === 'ASSISTANT_CONVERSATION_CLOSED'
          )
            response = await assistantApi.turn(boardId, base);
          else throw error;
        }
        queryClient.setQueryData(keys.assistantLatest(boardId), response.conversation);
        return { kind: 'answered', conversation: response.conversation };
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 429 &&
          (REFUSALS as string[]).includes(error.code ?? '')
        ) {
          const body = error.body as { resetsAt?: string | null } | undefined;
          return {
            kind: 'refused',
            code: error.code as RefusalCode,
            resetsAt: body?.resetsAt ?? null,
          };
        }
        return { kind: 'failed' };
      } finally {
        setPending(false);
      }
    },
    [boardId, keys, queryClient],
  );

  return { ask, isPending };
}
