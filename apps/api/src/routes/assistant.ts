import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  apiErrorSchema,
  assistantTurnRequestSchema,
  assistantTurnResponseSchema,
  captureSuggestRequestSchema,
  captureSuggestResponseSchema,
  suggestionDecisionResponseSchema,
  suggestionDecisionSchema,
  suggestionListSchema,
  tidyDecisionResponseSchema,
  tidyDecisionSchema,
  tidyRequestSchema,
  tidyResponseSchema,
} from '@wally/shared';
import { loadEnv } from '../env.js';
import {
  createConfiguredSuggestionRunner,
  createConfiguredTidyRunner,
  createConfiguredTurnRunner,
  type SuggestionRunner,
  type TidyRunner,
  type TurnRunner,
} from '../lib/assistant/model/index.js';
import {
  decideSuggestion,
  pendingSuggestions,
  suggestForCapture,
} from '../lib/assistant/suggestions.js';
import { assistantEnabledFor } from '../lib/assistant/switch.js';
import { decideTidy, proposeTidy } from '../lib/assistant/tidy.js';
import { runAssistantTurn } from '../lib/assistant/turn.js';
import { requireAccess } from '../lib/commands/context.js';
import { liveBoard } from '../lib/db/records.js';
import { AppError } from '../lib/errors.js';

const params = z.object({
  id: z.string().min(1).max(128),
});
const suggestionParams = z.object({
  id: z.string().min(1).max(128),
  suggestionId: z.string().min(1).max(128),
});
const tidyParams = z.object({
  id: z.string().min(1).max(128),
  tidyId: z.string().min(1).max(128),
});
/**
 * A budget refusal carries the reset time; the per-route rate limit answers the same status
 * through the error handler without one, so `resetsAt` is optional here.
 */
const refused = apiErrorSchema;

export interface AssistantRouteOptions {
  runner?: TurnRunner;
  suggestionRunner?: SuggestionRunner;
  tidyRunner?: TidyRunner;
  enabled?: boolean;
  deadlineMs?: number;
}

/**
 * The assistant panel's routes. Every route answers 404 unless the caller is a member and
 * the effective switch is on, so a switched-off assistant is invisible (RFC-0003-wally-agent.md §3.2).
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
  let suggestionRunner: SuggestionRunner | undefined = options.suggestionRunner;
  const getSuggestionRunner = () => (suggestionRunner ??= createConfiguredSuggestionRunner(env));
  let tidyRunner: TidyRunner | undefined = options.tidyRunner;
  const getTidyRunner = () => (tidyRunner ??= createConfiguredTidyRunner(env));

  async function boardFor(
    request: Pick<FastifyRequest, 'server' | 'user'> & { params: { id: string } },
  ) {
    const board = await liveBoard(request.server.db, request.params.id);
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
    async (request) => {
      const { board, role } = await boardFor(request);
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
          language: request.user.language,
          board,
          role,
          request: request.body,
        },
      );
      return { conversation };
    },
  );

  app.post(
    '/whiteboards/:id/assistant/captures',
    {
      schema: {
        params,
        body: captureSuggestRequestSchema,
        response: { 200: captureSuggestResponseSchema, 429: refused },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request) => {
      const { board, role } = await boardFor(request);
      const suggestion = await suggestForCapture(
        {
          db: request.server.db,
          env,
          runner: getSuggestionRunner(),
          logger: request.log,
          deadlineMs: options.deadlineMs,
        },
        { actor: request.user, language: request.user.language, board, role },
        request.body,
      );
      return { suggestion };
    },
  );

  app.post(
    '/whiteboards/:id/assistant/suggestions/:suggestionId/decision',
    {
      schema: {
        params: suggestionParams,
        body: suggestionDecisionSchema,
        response: { 200: suggestionDecisionResponseSchema },
      },
    },
    async (request) => {
      const { board, role } = await boardFor(request);
      // A decision never calls the model, so it never builds the runner either.
      const suggestion = await decideSuggestion(
        { db: request.server.db, env, logger: request.log },
        { actor: request.user, language: request.user.language, board, role },
        request.params.suggestionId,
        request.body,
      );
      return { suggestion };
    },
  );

  app.get(
    '/whiteboards/:id/assistant/suggestions/pending',
    { schema: { params, response: { 200: suggestionListSchema } } },
    async (request) => {
      const { board } = await boardFor(request);
      return { suggestions: await pendingSuggestions(request.server.db, request.user, board) };
    },
  );

  app.post(
    '/whiteboards/:id/assistant/tidies',
    {
      schema: {
        params,
        body: tidyRequestSchema,
        response: { 200: tidyResponseSchema, 429: refused },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request) => {
      const { board, role } = await boardFor(request);
      const tidy = await proposeTidy(
        {
          db: request.server.db,
          env,
          runner: getTidyRunner(),
          logger: request.log,
          deadlineMs: options.deadlineMs,
        },
        { actor: request.user, language: request.user.language, board, role },
        request.body,
      );
      return { tidy };
    },
  );

  app.post(
    '/whiteboards/:id/assistant/tidies/:tidyId/decision',
    {
      schema: {
        params: tidyParams,
        body: tidyDecisionSchema,
        response: { 200: tidyDecisionResponseSchema },
      },
    },
    async (request) => {
      const { board, role } = await boardFor(request);
      // A decision never calls the model, so it never builds the runner either.
      const tidy = await decideTidy(
        { db: request.server.db, env, logger: request.log },
        { actor: request.user, language: request.user.language, board, role },
        request.params.tidyId,
        request.body,
      );
      return { tidy };
    },
  );
}
