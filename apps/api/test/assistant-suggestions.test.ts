import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  SuggestionInput,
  SuggestionOutput,
  SuggestionRunner,
} from '../src/lib/assistant/model/index.js';
import {
  assistantAuditCol,
  assistantSuggestionsCol,
  assistantUsageCol,
  notesCol,
} from '../src/lib/db/collections.js';
import { dayKey } from '../src/lib/assistant/budget/ledger.js';
import { estimateTokens } from '../src/lib/assistant/budget/estimate.js';
import { suggestionSchemaJson } from '../src/lib/assistant/model/index.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { runOperation, type OperationContext } from '../src/lib/assistant/run.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-assistant-suggestions';
const usage = { inputTokens: 50, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 };

/** The last prompt the fake saw, so a test can assert what reached the model. */
let lastInput: SuggestionInput | null = null;

/** Slice 3's fields, which these replies propose nothing for. */
const noProposal = { title: null, reference: null, subtasks: null };
/** Keyed on the title line: the fake answers like a model would. */
const fakeRunner: SuggestionRunner = async (input): Promise<SuggestionOutput> => {
  lastInput = input;
  const lease = await input.onAttempt({ stepNumber: 0, messageCount: 1, maxOutputTokens: 256 });
  const title = input.prompt.split('\n')[0]!.slice('Title: '.length);
  const settle = async (fields: SuggestionOutput['fields']): Promise<SuggestionOutput> => {
    await lease.settle(usage);
    return { fields, usage, finishReason: 'stop' };
  };
  if (title.startsWith('fail'))
    throw Object.assign(new Error('quota for secret-project'), {
      name: 'AI_APICallError',
      statusCode: 429,
    });
  if (title.startsWith('nothing'))
    return settle({ dueDate: null, priority: null, assignee: null, ...noProposal });
  if (title.startsWith('all')) {
    // The first word after `all` is the member the model names; the rest is ordinary text.
    const memberId = title.slice('all '.length).split(' ')[0] || 'nobody';
    return settle({
      dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Freitag' },
      priority: { value: 'HOCH', confidence: 0.8, reason: 'dringend' },
      assignee: { memberId, confidence: 0.95, reason: 'Anna' },
      ...noProposal,
    });
  }
  // The provider reported no usage: nothing is settled, so the reservation stays (R7).
  if (title.startsWith('unknown'))
    return {
      fields: {
        dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Freitag' },
        priority: null,
        assignee: null,
        ...noProposal,
      },
      usage: null,
      finishReason: 'stop',
    };
  // A date before the person's today (2026-10-17 in these tests).
  if (title.startsWith('past'))
    return settle({
      dueDate: { value: '2026-10-01', confidence: 0.9, reason: 'Anfang Oktober' },
      priority: null,
      assignee: null,
      ...noProposal,
    });
  if (title.startsWith('unsure'))
    return settle({
      dueDate: { value: '2026-10-23', confidence: 0.3, reason: 'vielleicht' },
      priority: null,
      assignee: null,
      ...noProposal,
    });
  return settle({
    dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Freitag' },
    priority: null,
    assignee: null,
    ...noProposal,
  });
};

describe('capture suggestions', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID, { suggestionRunner: fakeRunner, assistantEnabled: true });
  });
  afterEach(async () => {
    lastInput = null;
    await resetDatabase(PROJECT_ID);
  });
  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });

  const createNote = (token: string, boardId: string, body: Record<string, unknown>) =>
    ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/notes`,
      headers: ctx.authHeader(token),
      payload: body,
    });
  const suggest = (token: string, boardId: string, noteId: string, locked: string[] = []) =>
    ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/assistant/captures`,
      headers: ctx.authHeader(token),
      payload: { noteId, locked, timeZone: 'Europe/Berlin', today: '2026-10-17' },
    });
  const decide = (token: string, boardId: string, id: string, body: Record<string, unknown>) =>
    ctx.inject({
      method: 'POST',
      url: `/whiteboards/${boardId}/assistant/suggestions/${id}/decision`,
      headers: ctx.authHeader(token),
      payload: body,
    });
  const pending = (token: string, boardId: string) =>
    ctx.inject({
      method: 'GET',
      url: `/whiteboards/${boardId}/assistant/suggestions/pending`,
      headers: ctx.authHeader(token),
    });
  const note = async (id: string) => (await notesCol(ctx.db).doc(id).get()).data()!;
  const stored = async (userId: string, id: string) =>
    (await assistantSuggestionsCol(ctx.db, userId).doc(id).get()).data()!;
  const inFlight = async (userId: string) =>
    Object.keys(
      (await assistantUsageCol(ctx.db, userId).doc(dayKey(new Date())).get()).data()?.inFlight ??
        {},
    ).length;
  const patchTitle = (token: string, noteId: string, title: string) =>
    ctx.inject({
      method: 'PATCH',
      url: `/notes/${noteId}`,
      headers: ctx.authHeader(token),
      payload: { title },
    });
  /**
   * The command layer exactly as a keep or an undo calls it, so a test can commit one write
   * of a suggestion's chain on its own: the state a keep or undo cut short leaves behind.
   */
  const asSuggestion = (userId: string, boardId: string, id: string): OperationContext => ({
    db: ctx.db,
    actor: { id: userId, email: `${userId}@fixture.de`, emailVerified: true },
    boardId,
    assistantEnabled: true,
    provenance: { via: 'assistant', conversationId: id, approvalId: id },
  });

  it('proposes the fields the note leaves empty and reserves then settles the call', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (
      await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor dringend' })
    ).json();
    const res = await suggest(fx.ownerToken, fx.boardId, n.id);
    expect(res.statusCode).toBe(200);
    const { suggestion } = res.json();
    expect(suggestion).toMatchObject({
      noteId: n.id,
      boardId: fx.boardId,
      status: 'PENDING',
      baseRevision: n.revision,
      fields: {
        dueDate: { value: '2026-10-23', reason: 'Freitag' },
        priority: { value: 'HOCH', reason: 'dringend' },
        assignee: { value: { id: 'fx-editor', displayName: 'Editor' }, reason: 'Anna' },
        title: null,
        reference: null,
        subtasks: null,
      },
      typed: [],
      kept: null,
    });
    const usageDoc = (
      await assistantUsageCol(ctx.db, fx.ownerId).doc(dayKey(new Date())).get()
    ).data();
    expect(usageDoc?.tokens).toBe(70);
    expect(usageDoc?.inFlight).toEqual({});
    // The prompt carries the words and the members by id; the note was not changed.
    expect(lastInput?.prompt).toContain('Title: all fx-editor dringend');
    expect(lastInput?.prompt).toContain('fx-editor: Editor');
    expect((await note(n.id)).revision).toBe(n.revision);
  });

  it('writes no record and makes no call when nothing is a candidate', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (
      await createNote(fx.ownerToken, fx.boardId, {
        title: 'all fx-editor',
        dueDate: '2026-10-20',
        priority: 'HOCH',
        assigneeId: 'fx-editor',
      })
    ).json();
    const res = await suggest(fx.ownerToken, fx.boardId, n.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion).toBeNull();
    expect(lastInput).toBeNull();
    expect((await assistantSuggestionsCol(ctx.db, fx.ownerId).get()).size).toBe(0);
  });

  it('never proposes a locked field, a filled field, or a person on a private note', async () => {
    const fx = await createBoardFixture(ctx);
    const locked = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const a = await suggest(fx.ownerToken, fx.boardId, locked.id, ['dueDate', 'priority']);
    expect(a.json().suggestion.fields).toMatchObject({
      dueDate: null,
      priority: null,
      assignee: { value: { id: 'fx-editor' } },
    });
    // What the person decided while writing is kept on the record, for the review's first group.
    expect(a.json().suggestion.typed).toEqual(['dueDate', 'priority']);
    expect((await stored(fx.ownerId, a.json().suggestion.id)).typed).toEqual([
      'dueDate',
      'priority',
    ]);
    const filled = (
      await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor', priority: 'NIEDRIG' })
    ).json();
    const b = await suggest(fx.ownerToken, fx.boardId, filled.id);
    expect(b.json().suggestion.fields.priority).toBeNull();
    const priv = (
      await createNote(fx.viewToken, fx.boardId, { title: 'all fx-editor', visibility: 'PRIVATE' })
    ).json();
    const c = await suggest(fx.viewToken, fx.boardId, priv.id);
    expect(c.statusCode).toBe(200);
    expect(c.json().suggestion.fields).toMatchObject({
      dueDate: { value: '2026-10-23' },
      priority: { value: 'HOCH' },
      assignee: null,
    });
  });

  it('reads a record from slice 2, with no title, reference or subtasks, as proposing nothing there', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (
      await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor dringend' })
    ).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    await assistantSuggestionsCol(ctx.db, fx.ownerId).doc(suggestion.id).update({
      typed: FieldValue.delete(),
      'fields.title': FieldValue.delete(),
      'fields.reference': FieldValue.delete(),
      'fields.subtasks': FieldValue.delete(),
      'operationIds.title': FieldValue.delete(),
      'operationIds.reference': FieldValue.delete(),
      'operationIds.subtasks': FieldValue.delete(),
    });
    const res = await pending(fx.ownerToken, fx.boardId);
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions[0]).toMatchObject({
      typed: [],
      fields: { title: null, reference: null, subtasks: null },
    });
    const kept = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(kept.json().suggestion.kept).toEqual({
      fields: ['dueDate', 'priority', 'assignee'],
      subtasks: [],
      revision: n.revision + 3,
    });
  });

  it('drops low confidence, unknown members and an empty reply without a record', async () => {
    const fx = await createBoardFixture(ctx);
    const unsure = (await createNote(fx.ownerToken, fx.boardId, { title: 'unsure' })).json();
    expect((await suggest(fx.ownerToken, fx.boardId, unsure.id)).json().suggestion).toBeNull();
    const stranger = (
      await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-outsider' })
    ).json();
    const s = (await suggest(fx.ownerToken, fx.boardId, stranger.id)).json().suggestion;
    expect(s.fields.assignee).toBeNull();
    expect(s.fields.dueDate).not.toBeNull();
    const nothing = (await createNote(fx.ownerToken, fx.boardId, { title: 'nothing' })).json();
    expect((await suggest(fx.ownerToken, fx.boardId, nothing.id)).json().suggestion).toBeNull();
    expect((await assistantSuggestionsCol(ctx.db, fx.ownerId).get()).size).toBe(1);
  });

  it('answers a provider failure with its own error and no record', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'fail' })).json();
    const res = await suggest(fx.ownerToken, fx.boardId, n.id);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'ASSISTANT_PROVIDER_ERROR', message: expect.any(String) });
    expect(JSON.stringify(res.json())).not.toContain('secret-project');
    expect((await assistantSuggestionsCol(ctx.db, fx.ownerId).get()).size).toBe(0);
    // Usage is unknown after a failed call, so its reservation stays charged (R7).
    expect(await inFlight(fx.ownerId)).toBe(1);
  });

  it('keeps the reservation when the provider reports no usage', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'unknown Freitag' })).json();
    const res = await suggest(fx.ownerToken, fx.boardId, n.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.fields.dueDate).toMatchObject({ value: '2026-10-23' });
    expect(await inFlight(fx.ownerId)).toBe(1);
    // Unsettled, the reservation is what stays charged: the instructions, the prompt and the
    // response schema the library sends with them, plus the output allowance.
    const charged = (
      await assistantUsageCol(ctx.db, fx.ownerId).doc(dayKey(new Date())).get()
    ).data()?.tokens;
    expect(charged).toBe(
      estimateTokens([lastInput!.instructions, lastInput!.prompt, await suggestionSchemaJson()]) +
        16 +
        256,
    );
    expect((await stored(fx.ownerId, res.json().suggestion.id)).usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it('keeps every field through the command layer, attributed, and remembers what was there', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'countdown',
    });
    expect(res.statusCode).toBe(200);
    const kept = res.json().suggestion;
    expect(kept.status).toBe('KEPT');
    expect(kept.kept.fields).toEqual(['dueDate', 'priority', 'assignee']);
    const after = await note(n.id);
    expect(after).toMatchObject({
      dueDate: '2026-10-23',
      priority: 'HOCH',
      assigneeId: 'fx-editor',
    });
    expect(after.revision).toBe(kept.kept.revision);
    expect(after.revision).toBe(n.revision + 3);
    const audits = (
      await assistantAuditCol(ctx.db).where('approvalId', '==', suggestion.id).get()
    ).docs.map((d) => d.data());
    expect(audits.map((a) => a.commandType).sort()).toEqual([
      'note.assign',
      'note.move',
      'note.update',
    ]);
    expect(audits.every((a) => a.actorId === fx.ownerId && a.targetId === n.id)).toBe(true);
    const stored = (
      await assistantSuggestionsCol(ctx.db, fx.ownerId).doc(suggestion.id).get()
    ).data()!;
    expect(stored.applied?.before).toEqual({ dueDate: null, priority: 'MITTEL', assigneeId: null });
    expect(stored.decision?.source).toBe('countdown');
  });

  it("drops a due date before the person's today, so nothing is proposed", async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'past' })).json();
    const res = await suggest(fx.ownerToken, fx.boardId, n.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion).toBeNull();
    expect((await assistantSuggestionsCol(ctx.db, fx.ownerId).get()).size).toBe(0);
  });

  it('proposes only on a note the caller wrote, before any model call', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const res = await suggest(fx.editToken, fx.boardId, n.id);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
    expect(lastInput).toBeNull();
    expect(
      (await assistantUsageCol(ctx.db, fx.editorId).doc(dayKey(new Date())).get()).exists,
    ).toBe(false);
    expect((await assistantSuggestionsCol(ctx.db, fx.editorId).get()).size).toBe(0);
  });

  it('keeps each named field once, in the canonical order', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'all fx-editor' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['priority', 'dueDate', 'dueDate'],
      source: 'enter',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.kept).toEqual({
      fields: ['dueDate', 'priority'],
      subtasks: [],
      revision: n.revision + 2,
    });
    expect((await stored(fx.editorId, suggestion.id)).decision?.fields).toEqual([
      'dueDate',
      'priority',
    ]);
  });

  it('keeps a subset when the person removed a field first', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['dueDate'],
      source: 'enter',
    });
    expect(res.json().suggestion.kept.fields).toEqual(['dueDate']);
    expect(await note(n.id)).toMatchObject({
      dueDate: '2026-10-23',
      priority: 'MITTEL',
      assigneeId: null,
    });
  });

  it('runs a keep once: a second keep from another tab replays the stored outcome', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    const body = { decision: 'keep', source: 'enter' };
    const [a, b] = await Promise.all([
      decide(fx.ownerToken, fx.boardId, suggestion.id, body),
      decide(fx.ownerToken, fx.boardId, suggestion.id, body),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    // The tab that lost the claim runs the same chain on the winner's receipts, so both
    // answer with the one kept outcome rather than a record still being written.
    expect(a.json().suggestion.kept).toEqual({
      fields: ['dueDate', 'priority', 'assignee'],
      subtasks: [],
      revision: n.revision + 3,
    });
    expect(b.json().suggestion.kept).toEqual(a.json().suggestion.kept);
    const again = await decide(fx.ownerToken, fx.boardId, suggestion.id, body);
    expect(again.json().suggestion.status).toBe('KEPT');
    expect((await note(n.id)).revision).toBe(n.revision + 3);
    const audits = await assistantAuditCol(ctx.db).where('approvalId', '==', suggestion.id).get();
    expect(audits.size).toBe(3);
  });

  it('refuses a keep once the note changed, and discards the record', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    await ctx.inject({
      method: 'PATCH',
      url: `/notes/${n.id}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { title: 'Geändert' },
    });
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'countdown',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    expect(await note(n.id)).toMatchObject({
      title: 'Geändert',
      dueDate: null,
      priority: 'MITTEL',
    });
    const stored = (
      await assistantSuggestionsCol(ctx.db, fx.ownerId).doc(suggestion.id).get()
    ).data()!;
    expect(stored.status).toBe('DISCARDED');
    const again = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('ASSISTANT_SUGGESTION_SETTLED');
  });

  it('undoes a keep by restoring the previous values, once', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (
      await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor', priority: 'MITTEL' })
    ).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    await decide(fx.ownerToken, fx.boardId, suggestion.id, { decision: 'keep', source: 'enter' });
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'shortcut',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.status).toBe('UNDONE');
    // The keep's own decision stays on the record; the undo is recorded beside it.
    const record = await stored(fx.ownerId, suggestion.id);
    expect(record.decision).toMatchObject({
      source: 'enter',
      fields: ['dueDate', 'priority', 'assignee'],
    });
    expect(record.undone).toMatchObject({ source: 'shortcut' });
    expect(record.undone?.at).toBeInstanceOf(Timestamp);
    const after = await note(n.id);
    expect(after).toMatchObject({
      dueDate: null,
      priority: 'MITTEL',
      assigneeId: null,
      title: 'all fx-editor',
    });
    expect(after.revision).toBe(n.revision + 6);
    const audits = await assistantAuditCol(ctx.db).where('approvalId', '==', suggestion.id).get();
    expect(audits.size).toBe(6);
    const again = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().suggestion.status).toBe('UNDONE');
    expect((await note(n.id)).revision).toBe(n.revision + 6);
  });

  it('refuses an undo once the note moved on, and the record stays kept', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'Freitag' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    await decide(fx.ownerToken, fx.boardId, suggestion.id, { decision: 'keep', source: 'enter' });
    await ctx.inject({
      method: 'PATCH',
      url: `/notes/${n.id}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { title: 'Danach' },
    });
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    expect(await note(n.id)).toMatchObject({ title: 'Danach', dueDate: '2026-10-23' });
    const stored = (
      await assistantSuggestionsCol(ctx.db, fx.ownerId).doc(suggestion.id).get()
    ).data()!;
    expect(stored.status).toBe('KEPT');
  });

  it('discards without touching the note, and a keep after that is refused', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'Freitag' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'discard',
      source: 'esc',
    });
    expect(res.json().suggestion.status).toBe('DISCARDED');
    expect((await note(n.id)).revision).toBe(n.revision);
    const keep = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(keep.statusCode).toBe(409);
  });

  it('lists the pending suggestions of this person on this board only', async () => {
    const fx = await createBoardFixture(ctx);
    const a = (await createNote(fx.ownerToken, fx.boardId, { title: 'Freitag a' })).json();
    const b = (await createNote(fx.ownerToken, fx.boardId, { title: 'Freitag b' })).json();
    const sa = (await suggest(fx.ownerToken, fx.boardId, a.id)).json().suggestion;
    const sb = (await suggest(fx.ownerToken, fx.boardId, b.id)).json().suggestion;
    await decide(fx.ownerToken, fx.boardId, sb.id, { decision: 'discard', source: 'esc' });
    const res = await pending(fx.ownerToken, fx.boardId);
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions.map((s: { id: string }) => s.id)).toEqual([sa.id]);
    expect((await pending(fx.editToken, fx.boardId)).json().suggestions).toEqual([]);
  });

  it('leaves out, and discards, a pending record whose note is gone, moved on, or a day old', async () => {
    const fx = await createBoardFixture(ctx);
    // The editor's own notes: the owner's captures in this file already come close to the
    // route's per-user rate limit of 30 a minute.
    const make = async (title: string) => {
      const n = (await createNote(fx.editToken, fx.boardId, { title })).json();
      return {
        note: n,
        suggestion: (await suggest(fx.editToken, fx.boardId, n.id)).json().suggestion,
      };
    };
    const fresh = await make('Freitag frisch');
    const gone = await make('Freitag weg');
    const moved = await make('Freitag bewegt');
    const old = await make('Freitag alt');
    expect(
      (
        await ctx.inject({
          method: 'DELETE',
          url: `/notes/${gone.note.id}`,
          headers: ctx.authHeader(fx.editToken),
        })
      ).statusCode,
    ).toBeLessThan(300);
    expect((await patchTitle(fx.editToken, moved.note.id, 'Freitag, geändert')).statusCode).toBe(
      200,
    );
    await assistantSuggestionsCol(ctx.db, fx.editorId)
      .doc(old.suggestion.id)
      .update({ createdAt: Timestamp.fromMillis(Date.now() - 25 * 3_600_000) });

    const res = await pending(fx.editToken, fx.boardId);
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions.map((s: { id: string }) => s.id)).toEqual([fresh.suggestion.id]);
    for (const skipped of [gone, moved, old])
      expect((await stored(fx.editorId, skipped.suggestion.id)).status).toBe('DISCARDED');
    expect((await stored(fx.editorId, fresh.suggestion.id)).status).toBe('PENDING');
    // Discarded for good: a keep from a tab that still shows one is refused.
    const keep = await decide(fx.editToken, fx.boardId, moved.suggestion.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(keep.statusCode).toBe(409);
  });

  it('never discards a day-old record that another tab kept while the pending list was read', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'Freitag behalten' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const keep = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(keep.statusCode).toBe(200);
    const kept = await stored(fx.editorId, suggestion.id);
    expect(kept.applied).toBeDefined();
    const ref = assistantSuggestionsCol(ctx.db, fx.editorId).doc(suggestion.id);
    // A day old and still pending when the list queries it...
    await ref.update({
      status: 'PENDING',
      decision: FieldValue.delete(),
      applied: FieldValue.delete(),
      createdAt: Timestamp.fromMillis(Date.now() - 25 * 3_600_000),
    });
    // ...and kept by another tab between that query and the cleanup: the notes read is the
    // one step in between.
    const getAll = ctx.db.getAll.bind(ctx.db);
    const spy = vi.spyOn(ctx.db, 'getAll').mockImplementation(async (...refs) => {
      if (refs.some((r) => 'path' in r && r.path === `notes/${n.id}`)) {
        spy.mockRestore();
        await ref.update({ status: 'KEPT', decision: kept.decision, applied: kept.applied });
      }
      return getAll(...refs);
    });
    try {
      const res = await pending(fx.editToken, fx.boardId);
      expect(res.statusCode).toBe(200);
      expect(res.json().suggestions).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    expect((await stored(fx.editorId, suggestion.id)).status).toBe('KEPT');
    const undo = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(undo.statusCode).toBe(200);
    expect(undo.json().suggestion.status).toBe('UNDONE');
    expect((await note(n.id)).dueDate).toBeNull();
  });

  it('a VIEW member keeps a due date on their own private note', async () => {
    const fx = await createBoardFixture(ctx);
    const priv = (
      await createNote(fx.viewToken, fx.boardId, { title: 'Freitag', visibility: 'PRIVATE' })
    ).json();
    const { suggestion } = (await suggest(fx.viewToken, fx.boardId, priv.id)).json();
    const res = await decide(fx.viewToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(res.statusCode).toBe(200);
    expect(await note(priv.id)).toMatchObject({ dueDate: '2026-10-23', assigneeId: fx.viewerId });
  });

  it('is invisible to an outsider, on another board, and when the switch is off', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'Freitag' })).json();
    expect((await suggest(fx.outsiderToken, fx.boardId, n.id)).statusCode).toBe(404);
    // The editor's own board does not hold this note. That board is reachable with the
    // switch on (its pending list answers 200), so the 404 is the note-to-board binding in
    // getNote, and it comes before any model call or record.
    expect((await pending(fx.editToken, fx.editorId)).statusCode).toBe(200);
    const elsewhere = await suggest(fx.editToken, fx.editorId, n.id);
    expect(elsewhere.statusCode).toBe(404);
    expect(elsewhere.json().error).toBe('NOT_FOUND');
    expect(lastInput).toBeNull();
    expect((await assistantSuggestionsCol(ctx.db, fx.editorId).get()).size).toBe(0);
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    expect(
      (await decide(fx.editToken, fx.boardId, suggestion.id, { decision: 'keep', source: 'enter' }))
        .statusCode,
    ).toBe(404);
    await ctx.inject({
      method: 'PATCH',
      url: `/whiteboards/${fx.boardId}/assistant`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { enabled: false },
    });
    expect((await suggest(fx.ownerToken, fx.boardId, n.id)).statusCode).toBe(404);
    expect((await pending(fx.ownerToken, fx.boardId)).statusCode).toBe(404);
  });
  it('drops an assignee who left the board since the proposal, from the card and the keep', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    expect(suggestion.fields.assignee).toMatchObject({ value: { id: 'fx-editor' } });
    const left = await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/leave`,
      headers: ctx.authHeader(fx.editToken),
    });
    expect(left.statusCode).toBe(204);
    // The user still exists; only the membership is gone, and that is what decides.
    const [shown] = (await pending(fx.ownerToken, fx.boardId)).json().suggestions;
    expect(shown.fields).toMatchObject({
      dueDate: { value: '2026-10-23' },
      priority: { value: 'HOCH' },
      assignee: null,
    });
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'countdown',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.kept).toEqual({
      fields: ['dueDate', 'priority'],
      subtasks: [],
      revision: n.revision + 2,
    });
    expect(await note(n.id)).toMatchObject({
      dueDate: '2026-10-23',
      priority: 'HOCH',
      assigneeId: null,
    });
  });

  it('a keep refused part way puts back what it wrote and discards the record', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    const record = await stored(fx.ownerId, suggestion.id);
    // The keep's first write commits, then a panel edit lands before its second write.
    await runOperation(asSuggestion(fx.ownerId, fx.boardId, suggestion.id), {
      name: 'update_note',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: n.revision,
        input: { dueDate: '2026-10-23' },
      },
      operationId: record.operationIds.dueDate.apply,
    });
    expect((await patchTitle(fx.ownerToken, n.id, 'Geändert')).statusCode).toBe(200);
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    // The due date the keep wrote is gone again; the person's edit stays.
    const after = await note(n.id);
    expect(after).toMatchObject({
      title: 'Geändert',
      dueDate: null,
      priority: 'MITTEL',
      assigneeId: null,
    });
    expect(after.revision).toBe(n.revision + 3);
    expect((await stored(fx.ownerId, suggestion.id)).status).toBe('DISCARDED');
    for (const decision of ['keep', 'undo']) {
      const again = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
        decision,
        source: 'enter',
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe('ASSISTANT_SUGGESTION_SETTLED');
    }
    expect((await note(n.id)).revision).toBe(n.revision + 3);
  });

  it('a repeat keep finishes a keep that was cut short, under the same receipts', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    const record = await stored(fx.ownerId, suggestion.id);
    // A keep claimed the record and committed its first write, then stopped (a crash, a
    // timeout): KEPT with nothing applied.
    await runOperation(asSuggestion(fx.ownerId, fx.boardId, suggestion.id), {
      name: 'update_note',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: n.revision,
        input: { dueDate: '2026-10-23' },
      },
      operationId: record.operationIds.dueDate.apply,
    });
    await assistantSuggestionsCol(ctx.db, fx.ownerId)
      .doc(suggestion.id)
      .update({
        status: 'KEPT',
        decision: {
          source: 'enter',
          fields: ['dueDate', 'priority', 'assignee'],
          at: record.createdAt,
        },
      });
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion).toMatchObject({
      status: 'KEPT',
      kept: { fields: ['dueDate', 'priority', 'assignee'], revision: n.revision + 3 },
    });
    expect(await note(n.id)).toMatchObject({
      dueDate: '2026-10-23',
      priority: 'HOCH',
      assigneeId: 'fx-editor',
    });
    expect((await note(n.id)).revision).toBe(n.revision + 3);
    const audits = await assistantAuditCol(ctx.db).where('approvalId', '==', suggestion.id).get();
    expect(audits.size).toBe(3);
    expect((await stored(fx.ownerId, suggestion.id)).applied?.before).toEqual({
      dueDate: null,
      priority: 'MITTEL',
      assigneeId: null,
    });
  });

  it('an undo of a keep that was cut short finishes the keep, then undoes it', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    const record = await stored(fx.ownerId, suggestion.id);
    await assistantSuggestionsCol(ctx.db, fx.ownerId)
      .doc(suggestion.id)
      .update({
        status: 'KEPT',
        decision: { source: 'enter', fields: ['dueDate'], at: record.createdAt },
      });
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.status).toBe('UNDONE');
    const after = await note(n.id);
    expect(after).toMatchObject({ dueDate: null, priority: 'MITTEL', assigneeId: null });
    expect(after.revision).toBe(n.revision + 2);
  });

  it('an undo refused part way puts back what it undid, and the record stays kept', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    const kept = (
      await decide(fx.ownerToken, fx.boardId, suggestion.id, { decision: 'keep', source: 'enter' })
    ).json().suggestion.kept;
    const record = await stored(fx.ownerId, suggestion.id);
    // The undo's first inverse write commits, then a panel edit lands before its second.
    await runOperation(asSuggestion(fx.ownerId, fx.boardId, suggestion.id), {
      name: 'assign_note',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: kept.revision,
        input: { assigneeId: null },
      },
      operationId: record.operationIds.assignee.undo,
    });
    expect((await patchTitle(fx.ownerToken, n.id, 'Danach')).statusCode).toBe(200);
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'shortcut',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    // Not half undone: the assignee the undo removed is back, beside the person's edit.
    expect(await note(n.id)).toMatchObject({
      title: 'Danach',
      dueDate: '2026-10-23',
      priority: 'HOCH',
      assigneeId: 'fx-editor',
    });
    expect((await stored(fx.ownerId, suggestion.id)).status).toBe('KEPT');
    // A second undo replays the first inverse write without writing, and is refused again.
    const revision = (await note(n.id)).revision;
    const again = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(again.json().error).toBe('STALE_REVISION');
    expect((await note(n.id)).revision).toBe(revision);
  });
});
