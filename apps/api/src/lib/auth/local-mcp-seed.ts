import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { WhiteboardDoc } from '../db/types.js';
import { bindKnownIdentity } from './identities.js';
import { AUTH0_ISSUER } from './constants.js';
import { membersCol, normalizeEmail, now, usersCol, whiteboardsCol } from '../db/collections.js';
import { executeBoardCommand } from '../commands/index.js';

/** Operator-only synthetic fixture. No server route and no authentication override. */
export async function seedMcpLocal(
  db: Firestore,
  input: { subject: string; email: string },
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!env.FIRESTORE_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error('Local MCP fixtures require the emulator');
  if (
    !('projectId' in db) ||
    !['wally-mcp-local', 'wally-mcp-local-test'].includes(String(db.projectId))
  )
    throw new Error('Local MCP fixtures require the isolated local project');
  const subject = z
    .string()
    .regex(/^(google-oauth2|auth0)\|[^/\s]+$/)
    .parse(input.subject);
  const email = normalizeEmail(z.string().email().parse(input.email));
  const ownerId = 'mcp-local-owner';
  const timestamp = now();
  const users = [
    { id: ownerId, email, displayName: 'Local MCP tester' },
    { id: 'mcp-local-other', email: 'other@example.invalid', displayName: 'Synthetic owner' },
  ];
  const boards: (Pick<WhiteboardDoc, 'name' | 'ownerId' | 'memberRoles'> & { id: string })[] = [
    { id: ownerId, name: 'MCP test board 1', ownerId, memberRoles: {} },
    { id: 'mcp-local-second', name: 'MCP test board 2', ownerId, memberRoles: {} },
    {
      id: 'mcp-local-shared',
      name: 'MCP shared test board',
      ownerId: 'mcp-local-other',
      memberRoles: { [ownerId]: 'EDIT' as const },
    },
  ];
  await db.runTransaction(async (tx) => {
    const userRefs = users.map((user) => usersCol(db).doc(user.id));
    const boardRefs = boards.map((board) => whiteboardsCol(db).doc(board.id));
    const memberRef = membersCol(db, 'mcp-local-shared').doc('mcp-local-member');
    const [userSnapshots, boardSnapshots, memberSnapshot] = await Promise.all([
      tx.getAll(...userRefs),
      tx.getAll(...boardRefs),
      tx.get(memberRef),
    ]);
    users.forEach(({ id: _id, ...user }, i) => {
      if (!userSnapshots[i]!.exists)
        tx.create(userRefs[i]!, {
          ...user,
          emailVerified: true,
          language: 'en',
          createdAt: timestamp,
          updatedAt: timestamp,
        });
    });
    boards.forEach(({ id: _id, ...board }, i) => {
      if (!boardSnapshots[i]!.exists)
        tx.create(boardRefs[i]!, {
          ...board,
          revision: 1,
          shareLinkToken: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
    });
    if (!memberSnapshot.exists)
      tx.create(memberRef, {
        whiteboardId: 'mcp-local-shared',
        userId: ownerId,
        invitedEmail: null,
        role: 'EDIT',
        status: 'ACTIVE',
        invitedAt: timestamp,
        activatedAt: timestamp,
      });
  });
  await bindKnownIdentity(db, { issuer: AUTH0_ISSUER, subject }, ownerId);
  // Commands provide valid note defaults and stable operation receipts for safe reruns.
  await executeBoardCommand(
    db,
    { id: ownerId, email, emailVerified: true },
    { type: 'note.create', boardId: ownerId, input: { title: 'Synthetic MCP read fixture' } },
    { operationId: '4ffb3955-56f1-4c57-a881-1245b56827ad' },
  );
}
