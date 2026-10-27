import { useCallback } from 'react';
import type { AssistantConversationDto } from '@wally/shared';
import { ApiError } from '@/lib/apiClient';
import { localDate } from '@/lib/localDate';
import { assistantApi } from '@/lib/resources';

export type RefusalCode = 'ASSISTANT_DAILY_CAP' | 'ASSISTANT_MONTHLY_CAP' | 'ASSISTANT_BUSY';
export type AskOutcome =
  | { kind: 'answered'; conversation: AssistantConversationDto }
  | { kind: 'refused'; code: RefusalCode; resetsAt: string | null }
  | { kind: 'failed' };

/** 429 codes the card renders as a refusal. RATE_LIMITED is the route's own limiter, which
 *  sends no reset time, so it reads as busy. */
const REFUSALS: Record<string, RefusalCode> = {
  ASSISTANT_DAILY_CAP: 'ASSISTANT_DAILY_CAP',
  ASSISTANT_MONTHLY_CAP: 'ASSISTANT_MONTHLY_CAP',
  ASSISTANT_BUSY: 'ASSISTANT_BUSY',
  RATE_LIMITED: 'ASSISTANT_BUSY',
};

/**
 * One question to the board. The API's three outcomes come back as data, never thrown, so
 * the card renders each in the answer's place. A conversation that closed underneath is
 * retried once without its id, which starts a new one.
 */
export function useAskAssistant(boardId: string) {
  return useCallback(
    async (message: string, conversationId: string | null): Promise<AskOutcome> => {
      const base = {
        message,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        today: localDate(),
      };
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
        return { kind: 'answered', conversation: response.conversation };
      } catch (error) {
        const code =
          error instanceof ApiError && error.status === 429 && error.code
            ? REFUSALS[error.code]
            : undefined;
        if (error instanceof ApiError && code) {
          const body = error.body as { resetsAt?: string | null } | undefined;
          return {
            kind: 'refused',
            code,
            resetsAt: error.code === 'RATE_LIMITED' ? null : (body?.resetsAt ?? null),
          };
        }
        return { kind: 'failed' };
      }
    },
    [boardId],
  );
}
