import type { BoardCommand, WhiteboardRole } from '@wally/shared';
import {
  docsWithId,
  isEmailVerified,
  loadUsers,
  membersCol,
  now,
  shareLinksCol,
  stripId,
  usersCol,
  whiteboardsCol,
  withId,
} from '../db/collections.js';
import type { MemberDoc, WithId } from '../db/types.js';
import { ownerMemberDto, toMemberDto, toShareLinkDto, toWhiteboardDto } from '../dto.js';
import { AppError } from '../errors.js';
import { strongestRole } from '../members.js';
import { generateShareToken } from '../tokens.js';
import { notFound, revisionOf, type CommandContext, type CommandResult } from './context.js';

export function rolesFromMembers(
  rows: WithId<MemberDoc>[],
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

export async function executeAdminCommand(
  ctx: CommandContext,
  command: BoardCommand,
): Promise<CommandResult> {
  const { db, tx, actor, board } = ctx;
  const boardRef = whiteboardsCol(db).doc(board.id);
  const timestamp = now();
  const revision = revisionOf(board) + 1;
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
  const updateBoard = (data: Record<string, unknown>) =>
    tx.update(boardRef, { ...data, revision, updatedAt: timestamp });
  if (command.type === 'board.rename') {
    if (command.input.name === board.name)
      return result(toWhiteboardDto(board, 'OWNER'), 200, revisionOf(board));
    updateBoard({ name: command.input.name });
    return result(
      toWhiteboardDto(
        { ...board, name: command.input.name, updatedAt: timestamp, revision },
        'OWNER',
      ),
    );
  }

  if (
    command.type === 'member.invite' ||
    command.type === 'member.update' ||
    command.type === 'member.delete' ||
    command.type === 'link.redeem'
  ) {
    const members = membersCol(db, board.id);
    const rows = docsWithId(await tx.get(members));
    let nextRows = [...rows];
    let next: WithId<MemberDoc> | undefined;
    let deletedUser: string | null = null;
    if (command.type === 'member.invite') {
      const candidates = docsWithId(
        await tx.get(usersCol(db).where('email', '==', command.input.email)),
      );
      const user = candidates.find(isEmailVerified);
      if (user?.id === board.ownerId)
        return result(
          ownerMemberDto(board, await loadUsers(db, [board.ownerId])),
          200,
          revisionOf(board),
        );
      const existing = rows.find(
        (row) =>
          (user && row.userId === user.id) ||
          (row.userId === null && row.invitedEmail === command.input.email),
      );
      next = existing
        ? { ...existing, role: command.input.role }
        : {
            id: members.doc().id,
            whiteboardId: board.id,
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
      const existing = rows.find(
        (row) => row.id === command.memberId && row.whiteboardId === board.id,
      );
      if (!existing || existing.userId === board.ownerId) notFound();
      nextRows = rows.filter((row) => row.id !== existing.id);
      if (command.type === 'member.update') {
        next = { ...existing, role: command.input.role };
        nextRows.push(next);
      } else {
        deletedUser = existing.userId;
        tx.delete(members.doc(existing.id));
      }
    } else {
      const link = withId(await tx.get(shareLinksCol(db).doc(command.token)));
      if (!link || link.whiteboardId !== board.id || board.shareLinkToken !== command.token)
        notFound();
      if (actor.id === board.ownerId)
        return result({ whiteboardId: board.id, role: link.role }, 200, revisionOf(board));
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
        ...(existing ?? { id: members.doc().id, whiteboardId: board.id, invitedAt: timestamp }),
        userId: actor.id,
        invitedEmail: null,
        role,
        status: 'ACTIVE',
        activatedAt: existing?.activatedAt ?? timestamp,
      };
      for (const duplicate of matching.slice(1)) tx.delete(members.doc(duplicate.id));
      nextRows = [...rows.filter((row) => !matching.some((match) => match.id === row.id)), next];
    }
    if (next) tx.set(members.doc(next.id), stripId(next));
    const memberRoles = rolesFromMembers(nextRows, board.ownerId);
    updateBoard({ memberRoles });
    let cleanupId: string | undefined;
    if (deletedUser && !memberRoles[deletedUser]) {
      cleanupId = `${actor.id}_${ctx.operationId}`;
      tx.create(db.collection('boardCleanup').doc(cleanupId), {
        kind: 'member.remove',
        boardId: board.id,
        userId: deletedUser,
        createdAt: timestamp,
      });
    }
    if (command.type === 'member.delete') return result(null, 204, revision, cleanupId);
    if (command.type === 'link.redeem') return result({ whiteboardId: board.id, role: next!.role });
    return result(toMemberDto(next!, await loadUsers(db, [next!.userId])));
  }

  if (
    command.type === 'link.create' ||
    command.type === 'link.update' ||
    command.type === 'link.rotate' ||
    command.type === 'link.delete'
  ) {
    const existing = board.shareLinkToken
      ? withId(await tx.get(shareLinksCol(db).doc(board.shareLinkToken)))
      : null;
    if (command.type === 'link.create' && board.shareLinkToken)
      throw new AppError(409, 'SHARE_LINK_EXISTS', 'A share link already exists for this board');
    if (command.type !== 'link.create' && (!existing || existing.whiteboardId !== board.id))
      notFound();
    if (command.type === 'link.delete') {
      tx.delete(shareLinksCol(db).doc(existing!.id));
      updateBoard({ shareLinkToken: null });
      return result(null, 204);
    }
    if (command.type === 'link.update' && existing!.role === command.input.role)
      return result(toShareLinkDto(existing!, ctx.baseUrl), 200, revisionOf(board));
    const token = command.type === 'link.update' ? existing!.id : generateShareToken();
    const link = {
      whiteboardId: board.id,
      role: command.type === 'link.rotate' ? existing!.role : command.input.role,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    if (command.type === 'link.rotate') tx.delete(shareLinksCol(db).doc(existing!.id));
    tx.set(shareLinksCol(db).doc(token), link);
    updateBoard({ shareLinkToken: token });
    return result(
      toShareLinkDto({ ...link, id: token }, ctx.baseUrl),
      command.type === 'link.create' ? 201 : 200,
    );
  }
  throw new Error('Not an administration command');
}
