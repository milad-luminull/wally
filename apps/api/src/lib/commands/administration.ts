import { and, eq, isNull } from 'drizzle-orm';
import { MAX_OWN_BOARDS, type BoardCommand, type WhiteboardRole } from '@wally/shared';
import { loadUsers } from '../db/records.js';
import { newId } from '../db/ids.js';
import type { MemberRow } from '../db/types.js';
import type { Transaction } from '../postgres/transaction.js';
import {
  boardCleanup,
  boardMembers,
  shareLinks,
  users,
  whiteboards,
} from '../postgres/schema/index.js';
import { ownerMemberDto, toMemberDto, toShareLinkDto, toWhiteboardDto } from '../dto.js';
import { AppError } from '../errors.js';
import { strongestRole } from '../members.js';
import { generateShareToken } from '../tokens.js';
import { notFound, type Actor, type CommandContext, type CommandResult } from './context.js';

export function rolesFromMembers(
  rows: MemberRow[],
  ownerId: string,
): Record<string, WhiteboardRole> {
  const roles: Record<string, WhiteboardRole> = {};
  for (const row of rows)
    if (row.userId && row.userId !== ownerId && row.status === 'ACTIVE')
      roles[row.userId] = strongestRole([
        ...(roles[row.userId] ? [roles[row.userId]!] : []),
        row.role,
      ])!;
  return roles;
}

/**
 * board.create has no board to authorize against: any signed-in user may create one, up to
 * MAX_OWN_BOARDS live boards (RFC 0002 §8, §12.4). The owned-board query runs inside the
 * command transaction so the count and the write commit together. New boards get generated
 * ids; only the first board, provisioned with the user record, shares the user's uid.
 */
export async function createBoard(
  tx: Transaction,
  actor: Actor,
  name: string,
): Promise<CommandResult> {
  const owned = await tx.$count(
    whiteboards,
    and(eq(whiteboards.ownerId, actor.id), isNull(whiteboards.deletedAt)),
  );
  if (owned >= MAX_OWN_BOARDS)
    throw new AppError(422, 'BOARD_LIMIT_REACHED', `You can own at most ${MAX_OWN_BOARDS} boards`);
  const timestamp = new Date();
  const [board] = await tx
    .insert(whiteboards)
    .values({
      id: newId(),
      name,
      ownerId: actor.id,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  return {
    data: toWhiteboardDto(board!, 'OWNER'),
    revision: 1,
    status: 201,
    boardId: board!.id,
  };
}

export async function executeAdminCommand(
  ctx: CommandContext,
  command: BoardCommand,
): Promise<CommandResult> {
  const { tx, actor, board } = ctx;
  const timestamp = new Date();
  const revision = board.revision + 1;
  const result = (
    data: unknown,
    status = 200,
    version = revision,
    cleanupId?: string,
  ): CommandResult => ({
    data,
    revision: version,
    status,
    boardId: board.id,
    ...(cleanupId ? { cleanupId } : {}),
  });
  const updateBoard = (data: Partial<typeof whiteboards.$inferInsert> = {}) =>
    tx
      .update(whiteboards)
      .set({ ...data, revision, updatedAt: timestamp })
      .where(eq(whiteboards.id, board.id));
  const enqueueCleanup = (job: Omit<typeof boardCleanup.$inferInsert, 'id' | 'createdAt'>) => {
    const cleanupId = `${actor.id}_${ctx.operationId}`;
    return tx
      .insert(boardCleanup)
      .values({ ...job, id: cleanupId, createdAt: timestamp })
      .then(() => cleanupId);
  };
  if (command.type === 'board.rename') {
    if (command.input.name === board.name)
      return result(toWhiteboardDto(board, 'OWNER'), 200, board.revision);
    await updateBoard({ name: command.input.name });
    return result(
      toWhiteboardDto(
        { ...board, name: command.input.name, updatedAt: timestamp, revision },
        'OWNER',
      ),
    );
  }
  if (command.type === 'board.assistant') {
    const disabled = !command.input.enabled;
    if (board.assistantDisabled === disabled)
      return result(toWhiteboardDto(board, 'OWNER'), 200, board.revision);
    await updateBoard({ assistantDisabled: disabled });
    return result(
      toWhiteboardDto(
        { ...board, assistantDisabled: disabled, updatedAt: timestamp, revision },
        'OWNER',
      ),
    );
  }

  // Tombstone, withdraw the share link and enqueue the physical deletion, all in this commit.
  // From here the board reads as absent for everyone (liveBoard); the cleanup job removes the
  // board and everything that cascades with it, and can be resumed by maintenance
  // (RFC 0002 §12.2).
  if (command.type === 'board.delete') {
    await tx.delete(shareLinks).where(eq(shareLinks.boardId, board.id));
    await updateBoard({ deletedAt: timestamp });
    const cleanupId = await enqueueCleanup({ kind: 'board.delete', boardId: board.id });
    return result(null, 204, revision, cleanupId);
  }

  if (
    command.type === 'member.invite' ||
    command.type === 'member.update' ||
    command.type === 'member.delete' ||
    command.type === 'board.leave' ||
    command.type === 'link.redeem'
  ) {
    const rows = await tx.select().from(boardMembers).where(eq(boardMembers.boardId, board.id));
    let nextRows = [...rows];
    let next: MemberRow | undefined;
    let deletedUser: string | null = null;
    if (command.type === 'member.invite') {
      const [user] = await tx
        .select()
        .from(users)
        .where(and(eq(users.email, command.input.email), eq(users.emailVerified, true)))
        .limit(1);
      if (user?.id === board.ownerId)
        return result(
          ownerMemberDto(board, await loadUsers(tx, [board.ownerId])),
          200,
          board.revision,
        );
      const existing = rows.find(
        (row) =>
          (user && row.userId === user.id) ||
          (row.userId === null && row.invitedEmail === command.input.email),
      );
      next = existing
        ? { ...existing, role: command.input.role }
        : {
            id: newId(),
            boardId: board.id,
            userId: null,
            invitedEmail: command.input.email,
            role: command.input.role,
            status: 'PENDING',
            invitedAt: timestamp,
            activatedAt: null,
          };
      if (user)
        next = {
          ...next,
          userId: user.id,
          invitedEmail: null,
          status: 'ACTIVE',
          activatedAt: next.activatedAt ?? timestamp,
        };
      nextRows = [...rows.filter((row) => row.id !== next!.id), next];
    } else if (command.type === 'member.update' || command.type === 'member.delete') {
      const existing = rows.find((row) => row.id === command.memberId);
      if (!existing || existing.userId === board.ownerId) notFound();
      nextRows = rows.filter((row) => row.id !== existing.id);
      if (command.type === 'member.update') {
        next = { ...existing, role: command.input.role };
        nextRows.push(next);
      } else {
        deletedUser = existing.userId;
        await tx.delete(boardMembers).where(eq(boardMembers.id, existing.id));
      }
    } else if (command.type === 'board.leave') {
      // The caller's own ACTIVE rows only; requireAccess already proved they hold one.
      const own = rows.filter((row) => row.userId === actor.id && row.status === 'ACTIVE');
      if (own.length === 0) notFound();
      nextRows = rows.filter((row) => !own.includes(row));
      for (const row of own) await tx.delete(boardMembers).where(eq(boardMembers.id, row.id));
      deletedUser = actor.id;
    } else {
      const [link] = await tx.select().from(shareLinks).where(eq(shareLinks.token, command.token));
      if (!link || link.boardId !== board.id) notFound();
      if (actor.id === board.ownerId)
        return result({ whiteboardId: board.id, role: link.role }, 200, board.revision);
      const matching = rows.filter(
        (row) =>
          row.userId === actor.id ||
          (actor.emailVerified &&
            row.userId === null &&
            row.invitedEmail === actor.email.toLowerCase()),
      );
      const claimable = matching.filter(
        (row) =>
          row.status === 'ACTIVE' ||
          (actor.emailVerified && row.invitedEmail === actor.email.toLowerCase()),
      );
      const role = strongestRole([link.role, ...claimable.map((row) => row.role)])!;
      const existing = matching[0];
      next = {
        ...(existing ?? { id: newId(), boardId: board.id, invitedAt: timestamp }),
        userId: actor.id,
        invitedEmail: null,
        role,
        status: 'ACTIVE',
        activatedAt: existing?.activatedAt ?? timestamp,
      };
      for (const duplicate of matching.slice(1))
        await tx.delete(boardMembers).where(eq(boardMembers.id, duplicate.id));
      nextRows = [...rows.filter((row) => !matching.some((match) => match.id === row.id)), next];
    }
    if (next) {
      const { userId, invitedEmail, role, status, activatedAt } = next;
      await tx.insert(boardMembers).values(next).onConflictDoUpdate({
        target: boardMembers.id,
        set: { userId, invitedEmail, role, status, activatedAt },
      });
    }
    const memberRoles = rolesFromMembers(nextRows, board.ownerId);
    await updateBoard();
    const cleanupId =
      deletedUser && !memberRoles[deletedUser]
        ? await enqueueCleanup({ kind: 'member.remove', boardId: board.id, userId: deletedUser })
        : undefined;
    if (command.type === 'member.delete' || command.type === 'board.leave')
      return result(null, 204, revision, cleanupId);
    if (command.type === 'link.redeem') return result({ whiteboardId: board.id, role: next!.role });
    return result(toMemberDto(next!, await loadUsers(tx, [next!.userId])));
  }

  if (
    command.type === 'link.create' ||
    command.type === 'link.update' ||
    command.type === 'link.rotate' ||
    command.type === 'link.delete'
  ) {
    const [existing] = await tx.select().from(shareLinks).where(eq(shareLinks.boardId, board.id));
    if (command.type === 'link.create' && existing)
      throw new AppError(409, 'SHARE_LINK_EXISTS', 'A share link already exists for this board');
    if (command.type !== 'link.create' && !existing) notFound();
    if (command.type === 'link.delete') {
      await tx.delete(shareLinks).where(eq(shareLinks.token, existing!.token));
      await updateBoard();
      return result(null, 204);
    }
    if (command.type === 'link.update' && existing!.role === command.input.role)
      return result(toShareLinkDto(existing!, ctx.baseUrl), 200, board.revision);
    const link = {
      token: command.type === 'link.update' ? existing!.token : generateShareToken(),
      boardId: board.id,
      role: command.type === 'link.rotate' ? existing!.role : command.input.role,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    // One link per board: the old row goes before the new one takes its place.
    if (existing) await tx.delete(shareLinks).where(eq(shareLinks.token, existing.token));
    await tx.insert(shareLinks).values(link);
    await updateBoard();
    return result(toShareLinkDto(link, ctx.baseUrl), command.type === 'link.create' ? 201 : 200);
  }
  throw new Error('Not an administration command');
}
