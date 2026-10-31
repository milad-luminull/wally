import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { executeBoardCommand, type Actor } from '../src/lib/commands/index.js';
import { and, eq } from 'drizzle-orm';
import {
  assistantAudit,
  boardOperations,
  noteHistory,
  whiteboards,
} from '../src/lib/postgres/schema/index.js';
import {
  ASSISTANT_AUDIT_RETENTION_DAYS,
  type Provenance,
} from '../src/lib/assistant/provenance.js';
import { AppError } from '../src/lib/errors.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const provenance: Provenance = { via: 'assistant', conversationId: 'conv-1', approvalId: 'appr-1' };

describe('assistant provenance on the command layer', () => {
  let ctx: TestContext;
  let boardId: string;
  let owner: Actor;

  beforeAll(async () => {
    ctx = await buildTestApp();
  });
  afterEach(async () => {
    await resetDatabase(ctx.db);
  });
  afterAll(async () => {
    await resetDatabase(ctx.db);
    await ctx.app.close();
  });

  async function fixture() {
    const fx = await createBoardFixture(ctx);
    boardId = fx.boardId;
    owner = { id: fx.ownerId, email: 'owner@fixture.de', emailVerified: true };
  }
  const receiptOf = async (operationId: string) =>
    (
      await ctx.db
        .select()
        .from(boardOperations)
        .where(
          and(eq(boardOperations.userId, owner.id), eq(boardOperations.operationId, operationId)),
        )
    )[0];
  const auditOf = async (operationId: string) =>
    (
      await ctx.db.select().from(assistantAudit).where(eq(assistantAudit.operationId, operationId))
    )[0];
  const historyOf = (noteId: string) =>
    ctx.db.select().from(noteHistory).where(eq(noteHistory.noteId, noteId));
  const create = (operationId: string, p: Provenance | undefined, title = 'Call Müller') =>
    executeBoardCommand(
      ctx.db,
      owner,
      { type: 'note.create', boardId, input: { title } },
      { operationId },
      { provenance: p },
    );

  it('stores provenance on the receipt, writes one audit record and marks the history event', async () => {
    await fixture();
    const operationId = randomUUID();
    const result = await create(operationId, provenance);
    const noteId = (result.data as { id: string }).id;

    expect((await receiptOf(operationId))?.provenance).toEqual(provenance);

    const audit = await auditOf(operationId);
    expect(audit).toMatchObject({
      operationId,
      actorId: owner.id,
      boardId,
      targetId: noteId,
      commandType: 'note.create',
      conversationId: 'conv-1',
      approvalId: 'appr-1',
      revision: 1,
    });
    const retentionMs = ASSISTANT_AUDIT_RETENTION_DAYS * 86400000;
    expect(audit!.expiresAt.getTime() - audit!.occurredAt.getTime()).toBeGreaterThan(
      retentionMs - 60000,
    );
    expect(audit!.expiresAt.getTime() - audit!.occurredAt.getTime()).toBeLessThan(
      retentionMs + 60000,
    );
    expect(audit).not.toHaveProperty('title');

    const history = await historyOf(noteId);
    expect(history).toHaveLength(1);
    expect(history[0]!.metadata).toEqual({ via: 'assistant' });
  });

  it('a replay returns the stored result and writes no second audit record', async () => {
    await fixture();
    const operationId = randomUUID();
    const first = await create(operationId, provenance);
    const second = await create(operationId, provenance);
    expect(second.data).toEqual(first.data);
    expect(await ctx.db.$count(assistantAudit)).toBe(1);
  });

  it('the same operation id with a different provenance is a key reuse', async () => {
    await fixture();
    const operationId = randomUUID();
    await create(operationId, provenance);
    await expect(
      create(operationId, { ...provenance, approvalId: 'appr-2' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
    } satisfies Partial<AppError>);
    expect(await ctx.db.$count(assistantAudit)).toBe(1);
  });

  it('a command without provenance leaves receipt, history and audit untouched', async () => {
    await fixture();
    const operationId = randomUUID();
    const result = await create(operationId, undefined);
    const noteId = (result.data as { id: string }).id;
    expect((await receiptOf(operationId))?.provenance).toBeNull();
    expect(await ctx.db.$count(assistantAudit)).toBe(0);
    const history = await historyOf(noteId);
    expect(history[0]!.metadata).toBeNull();
  });

  it('a move keeps its own metadata and adds via', async () => {
    await fixture();
    const created = await create(randomUUID(), provenance);
    const noteId = (created.data as { id: string }).id;
    await executeBoardCommand(
      ctx.db,
      owner,
      { type: 'note.move', noteId, boardId, input: { mode: 'HORIZON', horizon: 'LATER' } },
      { operationId: randomUUID(), expectedRevision: created.revision },
      { provenance },
    );
    const history = await historyOf(noteId);
    const moved = history.find((h) => h.type === 'MOVED');
    expect(moved?.metadata).toEqual({
      mode: 'HORIZON',
      from: 'TODAY',
      to: 'LATER',
      via: 'assistant',
    });
    const audits = await ctx.db.select().from(assistantAudit);
    expect(audits.map((a) => a.commandType).sort()).toEqual(['note.create', 'note.move']);
    expect(audits.find((a) => a.commandType === 'note.move')?.targetId).toBe(noteId);
  });

  it('a board command records no target note', async () => {
    await fixture();
    const [board] = await ctx.db.select().from(whiteboards).where(eq(whiteboards.id, boardId));
    const operationId = randomUUID();
    await executeBoardCommand(
      ctx.db,
      owner,
      { type: 'board.rename', boardId, input: { name: 'Renamed' } },
      { operationId, expectedRevision: board?.revision ?? 0 },
      { provenance },
    );
    const audit = await auditOf(operationId);
    expect(audit).toMatchObject({ commandType: 'board.rename', boardId, targetId: null });
  });
});
