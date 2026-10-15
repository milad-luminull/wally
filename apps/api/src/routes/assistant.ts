import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  assistantConversationDtoSchema,
  assistantTurnRequestSchema,
  assistantTurnResponseSchema,
} from '@wally/shared';
import { loadEnv } from '../env.js';
import { BudgetError } from '../lib/assistant/budget/ledger.js';
import {
  latestOpenConversation,
  loadConversation,
  toVisibleConversationDto,
} from '../lib/assistant/conversations.js';
import { createConfiguredTurnRunner, type TurnRunner } from '../lib/assistant/model/index.js';
import { assistantEnabledFor } from '../lib/assistant/switch.js';
import { runAssistantTurn } from '../lib/assistant/turn.js';
import { requireAccess } from '../lib/commands/context.js';
import { liveWhiteboard, userLanguage, whiteboardsCol } from '../lib/db/collections.js';
import { AppError } from '../lib/errors.js';

const params = z.object({
  id: z.string().min(1).max(128),
  conversationId: z.string().min(1).max(128).optional(),
});
/**
 * A budget refusal carries the reset time; the per-route rate limit answers the same status
 * through the error handler without one, so `resetsAt` is optional here.
 */
const refused = z.object({
  error: z.string(),
  message: z.string(),
  resetsAt: z.string().nullable().optional(),
});

export interface AssistantRouteOptions {
  runner?: TurnRunner;
  enabled?: boolean;
  deadlineMs?: number;
}

/**
 * The assistant panel's routes. Every route answers 404 unless the caller is a member and
 * the effective switch is on, so a switched-off assistant is invisible (WALLY_AGENT.md §3.2).
 */
export default async function assistantRoutes(
  fastify: FastifyInstance,
  options: AssistantRouteOptions,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const env = loadEnv();
  const enabledEnv = { ASSISTANT_ENABLED: options.enabled ?? env.ASSISTANT_ENABLED };
  // Built on first use: boot never needs model credentials.
  let runner: TurnRunner | undefined = options.runner;
  const getRunner = () => (runner ??= createConfiguredTurnRunner(env));

  async function boardFor(
    request: Pick<FastifyRequest, 'server' | 'user'> & { params: { id: string } },
  ) {
    const board = liveWhiteboard(
      await whiteboardsCol(request.server.db).doc(request.params.id).get(),
    );
    const role = requireAccess(board, request.user.id, ['OWNER', 'EDIT', 'VIEW']);
    if (!assistantEnabledFor(enabledEnv, board!)) throw new AppError(404, 'NOT_FOUND', 'Not found');
    return { board: board!, role };
  }

  app.post(
    '/whiteboards/:id/assistant/turns',
    {
      schema: {
        params,
        body: assistantTurnRequestSchema,
        response: { 200: assistantTurnResponseSchema, 429: refused },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { board, role } = await boardFor(request);
      try {
        const conversation = await runAssistantTurn(
          {
            db: request.server.db,
            env,
            runner: getRunner(),
            logger: request.log,
            deadlineMs: options.deadlineMs,
          },
          {
            actor: request.user,
            language: userLanguage(request.user),
            board,
            role,
            request: request.body,
          },
        );
        return { conversation };
      } catch (error) {
        if (error instanceof BudgetError)
          return reply
            .code(429)
            .send({ error: error.code, message: error.message, resetsAt: error.resetsAt });
        throw error;
      }
    },
  );

  app.get(
    '/whiteboards/:id/assistant/conversations/latest',
    { schema: { params, response: { 200: assistantConversationDtoSchema } } },
    async (request) => {
      const { board } = await boardFor(request);
      const conversation = await latestOpenConversation(
        request.server.db,
        request.user.id,
        board.id,
      );
      if (!conversation) throw new AppError(404, 'NOT_FOUND', 'Not found');
      return toVisibleConversationDto(request.server.db, request.user, conversation);
    },
  );

  app.get(
    '/whiteboards/:id/assistant/conversations/:conversationId',
    { schema: { params, response: { 200: assistantConversationDtoSchema } } },
    async (request) => {
      const { board } = await boardFor(request);
      const conversation = await loadConversation(
        request.server.db,
        request.user.id,
        board.id,
        request.params.conversationId!,
      );
      if (!conversation) throw new AppError(404, 'NOT_FOUND', 'Not found');
      return toVisibleConversationDto(request.server.db, request.user, conversation);
    },
  );
}
