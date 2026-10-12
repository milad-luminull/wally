import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { inviteCreateSchema, memberDtoSchema, memberRoleUpdateSchema } from '@wally/shared';
import {
  docsWithId,
  loadUsers,
  membersCol,
  notesCol,
  now,
  whiteboardsCol,
  withId,
} from '../lib/db/collections.js';
import { requireRole, requireWhiteboardAccess } from '../lib/authorization.js';
import { toMemberDto } from '../lib/dto.js';
import {
  memberRoleRemoval,
  memberRoleUpdate,
  strongestRole,
  upsertInvite,
} from '../lib/members.js';
import { AppError } from '../lib/errors.js';

const whiteboardIdParams = z.object({ id: z.string() });
const memberParams = z.object({ id: z.string(), memberId: z.string() });

export default async function memberRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/whiteboards/:id/members/invite',
    {
      // Tighter than the global budget: an invite is the one authenticated action that
      // sends a stranger's address into a privilege decision, and nothing else on the board
      // is worth issuing dozens of per minute.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: {
        params: whiteboardIdParams,
        body: inviteCreateSchema,
        response: { 200: memberDtoSchema },
      },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const db = request.server.db;
      const email = request.body.email; // already trimmed + lowercased by the shared schema
      const role = request.body.role;

      const member = await upsertInvite(db, ctx.whiteboardId, email, role);
      const users = await loadUsers(db, [member.userId]);
      return toMemberDto(member, users);
    },
  );

  app.patch(
    '/whiteboards/:id/members/:memberId',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: {
        params: memberParams,
        body: memberRoleUpdateSchema,
        response: { 200: memberDtoSchema },
      },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const db = request.server.db;
      const members = membersCol(db, ctx.whiteboardId);

      const existing = withId(await members.doc(request.params.memberId).get());
      if (!existing || existing.whiteboardId !== ctx.whiteboardId) {
        throw new AppError(404, 'NOT_FOUND', 'Not found');
      }

      const role = request.body.role;
      const member = await db.runTransaction(async (tx) => {
        // ---- reads ----
        // Every decision below uses this read, never `existing`: an invite can activate
        // between the two, and acting on the stale PENDING snapshot would skip the cache.
        const row = withId(await tx.get(members.doc(existing.id)));
        if (!row) throw new AppError(404, 'NOT_FOUND', 'Not found');
        // Read the subcollection whole: a where('userId').where('status') query here would
        // need a COLLECTION-scoped composite index, and the one in firestore.indexes.json
        // is COLLECTION_GROUP.
        const rows = row.userId ? docsWithId(await tx.get(members)) : [];

        // ---- writes ----
        tx.update(members.doc(row.id), { role });

        // memberRoles mirrors ACTIVE members only. A PENDING row grants nothing yet, even
        // when it happens to carry a userId, and editing its role must not become a way to
        // promote it into live access without the address ever being confirmed.
        if (!row.userId || row.status !== 'ACTIVE') return { ...row, role };

        // The row being edited is not necessarily the only one this user holds here, so the
        // cache is recomputed rather than overwritten from this row alone.
        const effective = strongestRole([
          role,
          ...rows
            .filter(
              (other) =>
                other.id !== row.id && other.userId === row.userId && other.status === 'ACTIVE',
            )
            .map((other) => other.role),
        ])!;
        tx.update(whiteboardsCol(db).doc(ctx.whiteboardId), {
          ...memberRoleUpdate(row.userId, effective),
          updatedAt: now(),
        });
        return { ...row, role };
      });

      return toMemberDto(member, await loadUsers(db, [member.userId]));
    },
  );

  app.delete(
    '/whiteboards/:id/members/:memberId',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: { params: memberParams },
    },
    async (request, reply) => {
      const ctx = request.whiteboardContext!;
      const db = request.server.db;
      const members = membersCol(db, ctx.whiteboardId);

      const existing = withId(await members.doc(request.params.memberId).get());
      if (!existing || existing.whiteboardId !== ctx.whiteboardId) {
        throw new AppError(404, 'NOT_FOUND', 'Not found');
      }

      // Whether the user retains ANY access afterwards. Decided inside the transaction,
      // because it also decides whether their notes should fall back to unassigned.
      // `undefined` means the row was already gone.
      const outcome = await db.runTransaction(async (tx) => {
        // ---- reads ----
        // Every decision below uses this read, never `existing`: a PENDING invite carrying
        // no userId can activate between the two, and acting on the stale snapshot would
        // delete the row while leaving its memberRoles entry granting access.
        const row = withId(await tx.get(members.doc(existing.id)));
        if (!row) return undefined;
        const rows = row.userId ? docsWithId(await tx.get(members)) : [];

        // ---- writes ----
        tx.delete(members.doc(row.id));
        if (!row.userId) return { userId: null, survivingRole: null };

        // Recompute from the rows that SURVIVE rather than dropping the key outright. A
        // user holding a second ACTIVE row still has legitimate access through the members
        // collection; blanking the cache cut them off entirely while that row lived on,
        // invisible to authorization and impossible to reason about.
        const role = strongestRole(
          rows
            .filter(
              (other) =>
                other.id !== row.id && other.userId === row.userId && other.status === 'ACTIVE',
            )
            .map((other) => other.role),
        );
        tx.update(whiteboardsCol(db).doc(ctx.whiteboardId), {
          ...(role ? memberRoleUpdate(row.userId, role) : memberRoleRemoval(row.userId)),
          updatedAt: now(),
        });
        return { userId: row.userId, survivingRole: role };
      });

      // Only once they have genuinely lost the board. A surviving row still lets them work
      // on it, so stripping their assignments would be wrong.
      if (outcome?.userId && outcome.survivingRole === null) {
        // Their notes fall back to unassigned. A separate pass because it is unbounded —
        // BulkWriter chunks it rather than hitting the 500-write cap on a single batch.
        const assigned = await notesCol(db)
          .where('whiteboardId', '==', ctx.whiteboardId)
          .where('assigneeId', '==', outcome.userId)
          .get();
        if (!assigned.empty) {
          const writer = db.bulkWriter();
          const updatedAt = now();
          for (const note of assigned.docs) {
            void writer.update(note.ref, { assigneeId: null, updatedAt });
          }
          await writer.close();
        }
      }

      return reply.code(204).send();
    },
  );
}
