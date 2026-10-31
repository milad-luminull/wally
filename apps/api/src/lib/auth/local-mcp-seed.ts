import { z } from 'zod';
import { bindKnownIdentity } from './identities.js';
import { AUTH0_ISSUER } from './constants.js';
import { normalizeEmail } from '../db/records.js';
import { assertLocalDatabase } from '../db/local.js';
import type { Database } from '../postgres/client.js';
import { withTransaction } from '../postgres/transaction.js';
import { boardMembers, users, whiteboards } from '../postgres/schema/index.js';
import { executeBoardCommand } from '../commands/index.js';

/** Operator-only synthetic fixture. No server route and no authentication override. */
export async function seedMcpLocal(
  db: Database,
  input: { subject: string; email: string },
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  assertLocalDatabase(env, 'Local MCP fixtures');
  const subject = z
    .string()
    .regex(/^(google-oauth2|auth0)\|[^/\s]+$/)
    .parse(input.subject);
  const email = normalizeEmail(z.string().email().parse(input.email));
  const ownerId = 'mcp-local-owner';
  const timestamp = new Date();
  const stamps = { createdAt: timestamp, updatedAt: timestamp };
  // Rows that already exist are left as they are, so a rerun changes nothing.
  await withTransaction(db, async (tx) => {
    await tx
      .insert(users)
      .values([
        { id: ownerId, email, displayName: 'Local MCP tester' },
        { id: 'mcp-local-other', email: 'other@example.invalid', displayName: 'Synthetic owner' },
      ].map((user) => ({ ...user, emailVerified: true, language: 'en' as const, ...stamps })))
      .onConflictDoNothing();
    await tx
      .insert(whiteboards)
      .values([
        { id: ownerId, name: 'MCP test board 1', ownerId },
        { id: 'mcp-local-second', name: 'MCP test board 2', ownerId },
        { id: 'mcp-local-shared', name: 'MCP shared test board', ownerId: 'mcp-local-other' },
      ].map((board) => ({ ...board, revision: 1, ...stamps })))
      .onConflictDoNothing();
    await tx
      .insert(boardMembers)
      .values({
        id: 'mcp-local-member',
        boardId: 'mcp-local-shared',
        userId: ownerId,
        role: 'EDIT',
        status: 'ACTIVE',
        invitedAt: timestamp,
        activatedAt: timestamp,
      })
      .onConflictDoNothing();
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
