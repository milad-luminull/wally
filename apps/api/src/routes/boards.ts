import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  memberDtoSchema,
  noteDetailDtoSchema,
  noteDtoSchema,
  noteListQuerySchema,
  shareLinkDtoSchema,
  shareLinkRedeemResultSchema,
  subtaskDtoSchema,
  whiteboardDtoSchema,
  whiteboardSummaryDtoSchema,
  type BoardCommand,
} from '@wally/shared';
import { executeBoardCommand } from '../lib/commands/index.js';
import {
  getBoard,
  getNote,
  getShareLink,
  listBoards,
  listMembers,
  listNotes,
  listTags,
} from '../lib/commands/queries.js';
import { userLanguage } from '../lib/db/collections.js';
import { loadEnv } from '../env.js';

type Params = Record<string, string>;
const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/);
const params = z.object({
  id: id.optional(),
  memberId: id.optional(),
  subtaskId: id.optional(),
  token: id.optional(),
});

export default async function boardRoutes(app: FastifyInstance) {
  const baseUrl = loadEnv().CORS_ORIGIN;
  const commands: {
    method: 'POST' | 'PATCH' | 'DELETE';
    url: string;
    type: BoardCommand['type'];
    response?: z.ZodTypeAny;
    status?: number;
    limit?: boolean;
  }[] = [
    {
      method: 'POST',
      url: '/whiteboards/:id/notes',
      type: 'note.create',
      response: noteDtoSchema,
      status: 201,
    },
    { method: 'PATCH', url: '/notes/:id', type: 'note.update', response: noteDtoSchema },
    ...(['move', 'assign', 'complete', 'reopen', 'duplicate'] as const).map((action) => ({
      method: 'POST' as const,
      url: `/notes/:id/${action}`,
      type: `note.${action}` as const,
      response: noteDtoSchema,
      status: action === 'duplicate' ? 201 : 200,
    })),
    { method: 'DELETE', url: '/notes/:id', type: 'note.delete', status: 204 },
    {
      method: 'POST',
      url: '/notes/:id/subtasks',
      type: 'subtask.create',
      response: subtaskDtoSchema,
      status: 201,
    },
    {
      method: 'PATCH',
      url: '/notes/:id/subtasks/:subtaskId',
      type: 'subtask.update',
      response: subtaskDtoSchema,
    },
    {
      method: 'DELETE',
      url: '/notes/:id/subtasks/:subtaskId',
      type: 'subtask.delete',
      status: 204,
    },
    // No per-route limit: MAX_OWN_BOARDS bounds it, and the global limit still applies.
    {
      method: 'POST',
      url: '/whiteboards',
      type: 'board.create',
      response: whiteboardDtoSchema,
      status: 201,
    },
    { method: 'DELETE', url: '/whiteboards/:id', type: 'board.delete', status: 204 },
    { method: 'POST', url: '/whiteboards/:id/leave', type: 'board.leave', status: 204 },
    {
      method: 'PATCH',
      url: '/whiteboards/:id',
      type: 'board.rename',
      response: whiteboardDtoSchema,
    },
    {
      method: 'PATCH',
      url: '/whiteboards/:id/assistant',
      type: 'board.assistant',
      response: whiteboardDtoSchema,
    },
    {
      method: 'POST',
      url: '/whiteboards/:id/members/invite',
      type: 'member.invite',
      response: memberDtoSchema,
      limit: true,
    },
    {
      method: 'PATCH',
      url: '/whiteboards/:id/members/:memberId',
      type: 'member.update',
      response: memberDtoSchema,
    },
    {
      method: 'DELETE',
      url: '/whiteboards/:id/members/:memberId',
      type: 'member.delete',
      status: 204,
    },
    {
      method: 'POST',
      url: '/whiteboards/:id/share-link',
      type: 'link.create',
      response: shareLinkDtoSchema,
      status: 201,
    },
    {
      method: 'PATCH',
      url: '/whiteboards/:id/share-link',
      type: 'link.update',
      response: shareLinkDtoSchema,
    },
    {
      method: 'POST',
      url: '/whiteboards/:id/share-link/rotate',
      type: 'link.rotate',
      response: shareLinkDtoSchema,
    },
    { method: 'DELETE', url: '/whiteboards/:id/share-link', type: 'link.delete', status: 204 },
    {
      method: 'POST',
      url: '/share-links/:token/redeem',
      type: 'link.redeem',
      response: shareLinkRedeemResultSchema,
      limit: true,
    },
  ];
  for (const route of commands)
    app.route<{ Params: Params }>({
      method: route.method,
      url: route.url,
      ...(route.limit ? { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } } : {}),
      schema: {
        params,
        ...(route.response ? { response: { [route.status ?? 200]: route.response } } : {}),
      },
      handler: async (request, reply) => {
        const target =
          route.type === 'board.create'
            ? {}
            : route.type === 'link.redeem'
              ? { token: request.params.token }
              : route.url.startsWith('/notes/')
                ? { noteId: request.params.id }
                : { boardId: request.params.id };
        const result = await executeBoardCommand(
          request.server.db,
          request.user,
          {
            type: route.type,
            ...target,
            ...(request.params.memberId ? { memberId: request.params.memberId } : {}),
            ...(request.params.subtaskId ? { subtaskId: request.params.subtaskId } : {}),
            input: request.body ?? {},
          },
          {
            operationId: request.headers['idempotency-key'],
            ...(request.headers['x-expected-revision'] !== undefined
              ? {
                  expectedRevision: /^\d+$/.test(String(request.headers['x-expected-revision']))
                    ? Number(request.headers['x-expected-revision'])
                    : NaN,
                }
              : {}),
          },
          { baseUrl, logger: request.log },
        );
        reply.header('X-Resource-Revision', result.revision).code(result.status);
        return result.status === 204 ? reply.send() : result.data;
      },
    });
  const reads: { url: string; schema: z.ZodTypeAny; query?: z.ZodTypeAny }[] = [
    { url: '/whiteboards', schema: z.array(whiteboardSummaryDtoSchema) },
    { url: '/whiteboards/:id', schema: whiteboardDtoSchema },
    { url: '/whiteboards/:id/notes', schema: z.array(noteDtoSchema), query: noteListQuerySchema },
    { url: '/whiteboards/:id/members', schema: z.array(memberDtoSchema) },
    { url: '/whiteboards/:id/tags', schema: z.array(z.string()) },
    { url: '/whiteboards/:id/share-link', schema: shareLinkDtoSchema },
    { url: '/notes/:id', schema: noteDetailDtoSchema },
  ];
  for (const route of reads)
    app.get<{ Params: Params }>(
      route.url,
      {
        schema: {
          params,
          response: { 200: route.schema },
          ...(route.query ? { querystring: route.query } : {}),
        },
      },
      async (request, reply) => {
        const { db } = request.server,
          actor = request.user,
          id = request.params.id!;
        switch (route.url) {
          case '/whiteboards':
            return listBoards(db, actor);
          case '/whiteboards/:id/notes':
            return listNotes(db, actor, id, request.query);
          case '/whiteboards/:id/tags':
            return listTags(db, actor, id, userLanguage(request.user));
          case '/whiteboards/:id': {
            const data = await getBoard(db, actor, id);
            reply.header('X-Resource-Revision', data.revision);
            return data;
          }
          case '/notes/:id': {
            const data = await getNote(db, actor, id);
            reply.header('X-Resource-Revision', data.revision);
            return data;
          }
          default: {
            const result = route.url.endsWith('/members')
              ? await listMembers(db, actor, id)
              : await getShareLink(db, actor, id, baseUrl);
            reply.header('X-Resource-Revision', result.revision);
            return result.data;
          }
        }
      },
    );
}
