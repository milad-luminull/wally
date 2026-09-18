import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { referenceOptionDtoSchema, referenceOptionQuerySchema } from '@wally/shared';
import { toReferenceOptionDto } from '../lib/dto.js';

export default async function referenceOptionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Not board-scoped — any authenticated user can list reference options (the global
  // auth preHandler already covers authentication; no whiteboard role check applies).
  app.get(
    '/reference-options',
    {
      schema: {
        querystring: referenceOptionQuerySchema,
        response: { 200: z.array(referenceOptionDtoSchema) },
      },
    },
    async (request) => {
      const options = await request.server.prisma.referenceOption.findMany({
        where: { type: request.query.type },
        orderBy: { label: 'asc' },
      });
      return options.map(toReferenceOptionDto);
    },
  );
}
