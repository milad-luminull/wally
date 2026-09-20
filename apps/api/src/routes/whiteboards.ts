import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  DEFAULT_LANGUAGE,
  memberDtoSchema,
  whiteboardDtoSchema,
  whiteboardRenameSchema,
  whiteboardSummaryDtoSchema,
  type WhiteboardRole,
} from '@wally/shared';
import type { WhiteboardDoc } from '../lib/db/types.js';
import {
  docsWithId,
  loadUsers,
  membersCol,
  membersGroup,
  notesCol,
  now,
  whiteboardsCol,
  withId,
} from '../lib/db/collections.js';
import { requireRole, requireWhiteboardAccess } from '../lib/authorization.js';
import { ownerMemberDto, toMemberDto, toWhiteboardDto } from '../lib/dto.js';
import { strongestRole } from '../lib/members.js';

const idParamsSchema = z.object({ id: z.string() });

export default async function whiteboardRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/whiteboards',
    { schema: { response: { 200: z.array(whiteboardSummaryDtoSchema) } } },
    async (request) => {
      const userId = request.user.id;
      const db = request.server.db;

      const [ownedSnapshot, membershipSnapshot] = await Promise.all([
        whiteboardsCol(db).where('ownerId', '==', userId).get(),
        // One collection-group query answers "every board I'm an active member of", and
        // the membership itself carries the role — no per-board role lookup needed.
        membersGroup(db).where('userId', '==', userId).where('status', '==', 'ACTIVE').get(),
      ]);

      const owned = docsWithId(ownedSnapshot);
      const ownedIds = new Set(owned.map((board) => board.id));

      // An owner who was also invited to their own board would otherwise appear twice.
      const memberships = docsWithId(membershipSnapshot).filter(
        (member) => !ownedIds.has(member.whiteboardId),
      );

      // One person can hold more than one ACTIVE row on the same board — an email invite
      // activating alongside a share-link redemption. Collapse them so a board appears
      // once, at the strongest role: listing it twice with conflicting roles is exactly how
      // a desynced memberRoles cache surfaces, and the strongest role is what authorization
      // will actually grant.
      //
      // Keying by board id also removes the positional coupling the old code had between
      // the getAll result and the memberships array.
      const roleByBoard = new Map<string, WhiteboardRole>();
      for (const member of memberships) {
        const current = roleByBoard.get(member.whiteboardId);
        roleByBoard.set(
          member.whiteboardId,
          current ? strongestRole([current, member.role])! : member.role,
        );
      }

      // getAll batches the reads into one round trip, but its signature drops the
      // collection's converter type — hence the cast back.
      const memberBoardIds = [...roleByBoard.keys()];
      const memberBoards = memberBoardIds.length
        ? ((await db.getAll(
            ...memberBoardIds.map((id) => whiteboardsCol(db).doc(id)),
          )) as DocumentSnapshot<WhiteboardDoc>[])
        : [];

      const summaries = [
        ...owned.map((board) => toWhiteboardDto(board, 'OWNER')),
        ...memberBoards.flatMap((snapshot) => {
          const board = withId(snapshot);
          const role = board ? roleByBoard.get(board.id) : undefined;
          return board && role ? [toWhiteboardDto(board, role)] : [];
        }),
      ];

      return summaries.map((w) => ({ id: w.id, name: w.name, currentUserRole: w.currentUserRole }));
    },
  );

  app.get(
    '/whiteboards/:id',
    {
      preHandler: [
        requireWhiteboardAccess({ kind: 'whiteboardParam' }),
        requireRole(['OWNER', 'EDIT', 'VIEW']),
      ],
      schema: { params: idParamsSchema, response: { 200: whiteboardDtoSchema } },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      return toWhiteboardDto(ctx.board, ctx.role);
    },
  );

  app.patch(
    '/whiteboards/:id',
    {
      preHandler: [requireWhiteboardAccess({ kind: 'whiteboardParam' }), requireRole(['OWNER'])],
      schema: {
        params: idParamsSchema,
        body: whiteboardRenameSchema,
        response: { 200: whiteboardDtoSchema },
      },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const name = request.body.name;
      const updatedAt = now();
      await whiteboardsCol(request.server.db).doc(ctx.whiteboardId).update({ name, updatedAt });

      return toWhiteboardDto({ ...ctx.board, name, updatedAt }, ctx.role);
    },
  );

  app.get(
    '/whiteboards/:id/members',
    {
      preHandler: [
        requireWhiteboardAccess({ kind: 'whiteboardParam' }),
        requireRole(['OWNER', 'EDIT', 'VIEW']),
      ],
      schema: { params: idParamsSchema, response: { 200: z.array(memberDtoSchema) } },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const db = request.server.db;
      const stored = docsWithId(
        await membersCol(db, ctx.whiteboardId).orderBy('invitedAt', 'asc').get(),
      );
      // The owner is not a member document (see ownerMemberDto), so prepend a synthetic row.
      // Filtering the owner out of `stored` guards against a legacy row from before invites
      // addressed to the owner were dropped: two rows for one person would render duplicate
      // Radix <SelectItem> values in the assignee picker.
      const members = stored.filter((member) => member.userId !== ctx.board.ownerId);
      const users = await loadUsers(db, [
        ctx.board.ownerId,
        ...members.map((member) => member.userId),
      ]);
      return [
        ownerMemberDto(ctx.board, users),
        ...members.map((member) => toMemberDto(member, users)),
      ];
    },
  );

  app.get(
    '/whiteboards/:id/tags',
    {
      preHandler: [
        requireWhiteboardAccess({ kind: 'whiteboardParam' }),
        requireRole(['OWNER', 'EDIT', 'VIEW']),
      ],
      schema: { params: idParamsSchema, response: { 200: z.array(z.string()) } },
    },
    async (request) => {
      const ctx = request.whiteboardContext!;
      const notes = await notesCol(request.server.db)
        .where('whiteboardId', '==', ctx.whiteboardId)
        .get();

      const tagSet = new Set<string>();
      for (const note of notes.docs) {
        for (const tag of note.data().tags) tagSet.add(tag);
      }
      // Ordered for the board, not for the reader — deliberately NOT request.user.language.
      // A tag list is shared state: per-caller collation would show two members of the same
      // board different orders for identical data, and the filter bar's chips would reorder
      // when a colleague switched language. The upside would be nil anyway — Intl's 'de' and
      // 'en' collations are indistinguishable for Latin-script tags (the German ordering that
      // genuinely differs is the phonebook variant, de-DE-u-co-phonebk, which this never
      // selected). One stable order, named rather than hardcoded.
      return [...tagSet].sort((a, b) => a.localeCompare(b, DEFAULT_LANGUAGE));
    },
  );
}
