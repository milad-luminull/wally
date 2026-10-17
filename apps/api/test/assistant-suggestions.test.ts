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
import { modelSuggestionSchema } from '../src/lib/assistant/model/suggest.js';
import { FieldValue, Timestamp, Transaction } from 'firebase-admin/firestore';
import { runOperation, type OperationContext } from '../src/lib/assistant/run.js';
import { buildTestApp, createBoardFixture, resetDatabase, type TestContext } from './helpers.js';

const PROJECT_ID = 'wally-test-assistant-suggestions';
const usage = { inputTokens: 50, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 };

/** The last prompt the fake saw, so a test can assert what reached the model. */
let lastInput: SuggestionInput | null = null;

/** Slice 3's fields, which these replies propose nothing for. */
const noProposal = { title: null, reference: null, subtasks: null };
/**
 * Keyed on the title line: the fake answers like a model would, and its reply gets the one
 * check a real runner's reply gets, so the route sees what a runner hands over.
 */
const fakeRunner: SuggestionRunner = async (input): Promise<SuggestionOutput> => {
  lastInput = input;
  const lease = await input.onAttempt({ stepNumber: 0, messageCount: 1, maxOutputTokens: 256 });
  const title = input.prompt.split('\n')[0]!.slice('Title: '.length);
  const settle = async (fields: SuggestionOutput['fields']): Promise<SuggestionOutput> => {
    await lease.settle(usage);
    const checked = modelSuggestionSchema.safeParse(fields);
    return { fields: checked.success ? checked.data : null, usage, finishReason: 'stop' };
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
  // Slice 3: a cleaner title, a property and three steps beside a date.
  if (title.startsWith('review'))
    return settle({
      dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Freitag' },
      priority: null,
      assignee: null,
      title: { value: 'Angebot an Müller', confidence: 0.8, reason: 'kürzer' },
      reference: { key: 'kunde', value: 'Müller GmbH', confidence: 0.9, reason: 'Kunde genannt' },
      subtasks: {
        items: ['Unterlagen prüfen', 'Angebot schreiben', 'Angebot senden'],
        confidence: 0.8,
        reason: 'drei Schritte',
      },
    });
  // A "cleaner" title that is the note's own: nothing to offer.
  if (title.startsWith('sametitle'))
    return settle({
      dueDate: null,
      priority: null,
      assignee: null,
      title: { value: 'sametitle', confidence: 0.9, reason: 'gleich' },
      reference: null,
      subtasks: null,
    });
  // A key the property schema refuses, and steps that are doubled or blank.
  if (title.startsWith('badref'))
    return settle({
      dueDate: null,
      priority: null,
      assignee: null,
      title: null,
      reference: { key: 'Kun.de', value: 'x', confidence: 0.9, reason: 'Punkt im Namen' },
      subtasks: { items: ['a', 'a', ' '], confidence: 0.9, reason: 'doppelt' },
    });
  // Doubled and blank steps beside two real ones: the two survive, in order.
  if (title.startsWith('dupsteps'))
    return settle({
      dueDate: null,
      priority: null,
      assignee: null,
      title: null,
      reference: null,
      subtasks: { items: [' a', 'a', ' ', 'b '], confidence: 0.9, reason: 'doppelt' },
    });
  // A cleaner title and nothing else: the countdown has nothing it may keep (plan R2).
  if (title.startsWith('titleonly'))
    return settle({
      dueDate: null,
      priority: null,
      assignee: null,
      title: { value: 'Nur ein Titel', confidence: 0.9, reason: 'kürzer' },
      reference: null,
      subtasks: null,
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
  /** The note as the panel reads it, with its subtasks in order. */
  const noteDetail = async (token: string, id: string) =>
    (
      await ctx.inject({ method: 'GET', url: `/notes/${id}`, headers: ctx.authHeader(token) })
    ).json() as { subtasks: { id: string; text: string }[] };
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
        customFields: { Projekt: 'X' },
      })
    ).json();
    await ctx.inject({
      method: 'POST',
      url: `/notes/${n.id}/subtasks`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { text: 'Schritt' },
    });
    // Every field is filled, the note has a property and a step, and the title was the
    // person's own decision.
    const res = await suggest(fx.ownerToken, fx.boardId, n.id, ['title']);
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
    expect(stored.applied?.before).toEqual({
      dueDate: null,
      priority: 'MITTEL',
      assigneeId: null,
      title: 'all fx-editor',
      reference: null,
    });
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
      title: 'all fx-editor',
      reference: null,
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

  // Slice 3. These run as the editor: the owner's captures in this file already come close
  // to the route's per-user rate limit of 30 a minute.

  it("proposes a title, a reference under the board's own key, and steps, and records what was typed", async () => {
    const fx = await createBoardFixture(ctx);
    // The board already uses "Kunde"; the model answers with "kunde".
    await createNote(fx.editToken, fx.boardId, {
      title: 'Alt',
      customFields: { Kunde: 'Alt GmbH' },
    });
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const res = await suggest(fx.editToken, fx.boardId, n.id, ['priority']);
    expect(res.statusCode).toBe(200);
    const { suggestion } = res.json();
    expect(suggestion.typed).toEqual(['priority']);
    expect(suggestion.fields).toMatchObject({
      dueDate: { value: '2026-10-23' },
      priority: null,
      title: { value: 'Angebot an Müller', reason: 'kürzer' },
      reference: { key: 'Kunde', value: 'Müller GmbH', reason: 'Kunde genannt' },
      subtasks: {
        items: ['Unterlagen prüfen', 'Angebot schreiben', 'Angebot senden'],
        reason: 'drei Schritte',
      },
    });
    expect(lastInput?.prompt).toContain('Properties on this board: Kunde');
    expect(lastInput?.maxOutputTokens).toBe(512);
    expect((await stored(fx.editorId, suggestion.id)).typed).toEqual(['priority']);
  });

  it("drops a title equal to the note's own, a reference with a bad key, and steps that are empty or doubled", async () => {
    const fx = await createBoardFixture(ctx);
    const same = (await createNote(fx.editToken, fx.boardId, { title: 'sametitle' })).json();
    expect((await suggest(fx.editToken, fx.boardId, same.id)).json().suggestion).toBeNull();
    // The key is refused, and one step left after the repeats and blanks is no breakdown:
    // steps come two to five (plan R7), so nothing survives and no record is written.
    const bad = (await createNote(fx.editToken, fx.boardId, { title: 'badref' })).json();
    expect((await suggest(fx.editToken, fx.boardId, bad.id)).json().suggestion).toBeNull();
    const dup = (await createNote(fx.editToken, fx.boardId, { title: 'dupsteps' })).json();
    const s = (await suggest(fx.editToken, fx.boardId, dup.id)).json().suggestion;
    expect(s.fields.subtasks).toEqual({ items: ['a', 'b'], reason: expect.any(String) });
    expect((await assistantSuggestionsCol(ctx.db, fx.editorId).get()).size).toBe(1);
  });

  it('the countdown never keeps a title: it keeps the rest, and a title alone waits for the person', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    // Even a countdown keep that names the title (the web at this point sends every
    // proposed field) leaves the person's title as it is.
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['dueDate', 'title', 'reference', 'subtasks'],
      source: 'countdown',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.kept).toEqual({
      fields: ['dueDate', 'reference', 'subtasks'],
      subtasks: [0, 1, 2],
      revision: n.revision + 5,
    });
    expect(await note(n.id)).toMatchObject({ title: 'review', dueDate: '2026-10-23' });

    const only = (await createNote(fx.editToken, fx.boardId, { title: 'titleonly' })).json();
    const proposal = (await suggest(fx.editToken, fx.boardId, only.id)).json().suggestion;
    expect(proposal.fields.title).toEqual({ value: 'Nur ein Titel', reason: 'kürzer' });
    const fired = await decide(fx.editToken, fx.boardId, proposal.id, {
      decision: 'keep',
      source: 'countdown',
    });
    expect(fired.statusCode).toBe(200);
    expect(fired.json().suggestion).toMatchObject({ status: 'PENDING', kept: null });
    expect(await note(only.id)).toMatchObject({ title: 'titleonly', revision: only.revision });
    expect((await stored(fx.editorId, proposal.id)).status).toBe('PENDING');
    // Ticked by the person, the title is kept.
    const ticked = await decide(fx.editToken, fx.boardId, proposal.id, {
      decision: 'keep',
      fields: ['title'],
      source: 'click',
    });
    expect(ticked.json().suggestion.kept.fields).toEqual(['title']);
    expect((await note(only.id)).title).toBe('Nur ein Titel');
  });

  it('never proposes a reference or steps on a note that has them, nor a title that was locked', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (
      await createNote(fx.editToken, fx.boardId, {
        title: 'review',
        customFields: { Projekt: 'X' },
      })
    ).json();
    await ctx.inject({
      method: 'POST',
      url: `/notes/${n.id}/subtasks`,
      headers: ctx.authHeader(fx.editToken),
      payload: { text: 'Schritt' },
    });
    const s = (await suggest(fx.editToken, fx.boardId, n.id, ['title'])).json().suggestion;
    expect(s.fields).toMatchObject({
      reference: null,
      subtasks: null,
      title: null,
      dueDate: { value: '2026-10-23' },
    });
    // `typed` names the chips' fields only: the title is in the first group whatever it says.
    expect(s.typed).toEqual([]);
  });

  it("keeps a subset: the date, the reference and one of three steps; the title stays the person's", async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['dueDate', 'reference', 'subtasks'],
      subtasks: [1],
      source: 'click',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.kept).toEqual({
      fields: ['dueDate', 'reference', 'subtasks'],
      subtasks: [1],
      revision: n.revision + 3,
    });
    const after = await note(n.id);
    expect(after).toMatchObject({ title: 'review', dueDate: '2026-10-23' });
    // No other note on this board uses the key, so it is written as the model spelled it.
    expect(after.customFields).toEqual({ kunde: 'Müller GmbH' });
    expect(after.subtaskSummary).toEqual({ total: 1, done: 0 });
    expect((await noteDetail(fx.editToken, n.id)).subtasks.map((t) => t.text)).toEqual([
      'Angebot schreiben',
    ]);
    const audits = await assistantAuditCol(ctx.db).where('approvalId', '==', suggestion.id).get();
    expect(audits.docs.map((d) => d.data().commandType).sort()).toEqual([
      'note.update',
      'note.update',
      'subtask.create',
    ]);
    expect((await stored(fx.editorId, suggestion.id)).decision?.subtasks).toEqual([1]);
  });

  it('drops the steps from a keep that names none of them, and ignores an index past the list', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['dueDate', 'subtasks'],
      subtasks: [4],
      source: 'click',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.kept).toEqual({
      fields: ['dueDate'],
      subtasks: [],
      revision: n.revision + 1,
    });
    expect((await note(n.id)).subtaskSummary.total).toBe(0);
  });

  it('refuses a keep once a property was set on the note after the proposal', async () => {
    const fx = await createBoardFixture(ctx);
    await createNote(fx.editToken, fx.boardId, {
      title: 'Alt',
      customFields: { Kunde: 'Alt GmbH' },
    });
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    // The proposal was for a note without properties; one set since makes the keep stale,
    // so a reference never overwrites a value the person wrote.
    await ctx.inject({
      method: 'PATCH',
      url: `/notes/${n.id}`,
      headers: ctx.authHeader(fx.editToken),
      payload: { fieldChanges: { set: { Kunde: 'Zwischen' } } },
    });
    const stale = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('STALE_REVISION');
    const after = await note(n.id);
    expect(after).toMatchObject({ title: 'review', dueDate: null });
    expect(after.customFields).toEqual({ Kunde: 'Zwischen' });
    expect(after.subtaskSummary.total).toBe(0);
  });

  it('undo after a full keep restores the title, removes the property and deletes every step, once', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const kept = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['dueDate', 'title', 'reference', 'subtasks'],
      source: 'click',
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().suggestion.kept).toEqual({
      fields: ['dueDate', 'title', 'reference', 'subtasks'],
      subtasks: [0, 1, 2],
      revision: n.revision + 6,
    });
    const keptNote = await note(n.id);
    expect(keptNote).toMatchObject({ title: 'Angebot an Müller' });
    expect(keptNote.customFields).toEqual({ kunde: 'Müller GmbH' });
    const steps = (await noteDetail(fx.editToken, n.id)).subtasks;
    expect(steps.map((t) => t.text)).toEqual([
      'Unterlagen prüfen',
      'Angebot schreiben',
      'Angebot senden',
    ]);
    const record = await stored(fx.editorId, suggestion.id);
    expect(record.applied).toMatchObject({
      before: { title: 'review', reference: { key: 'kunde', previous: null } },
      subtasks: [0, 1, 2],
      subtaskIds: steps.map((t) => t.id),
    });
    const undone = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'shortcut',
    });
    expect(undone.statusCode).toBe(200);
    const after = await note(n.id);
    expect(after).toMatchObject({ title: 'review', dueDate: null });
    expect(after.customFields).toEqual({});
    expect(after.subtaskSummary.total).toBe(0);
    expect(after.revision).toBe(n.revision + 12);
    const audits = await assistantAuditCol(ctx.db).where('approvalId', '==', suggestion.id).get();
    expect(audits.docs.filter((d) => d.data().commandType === 'subtask.delete')).toHaveLength(3);
    const again = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(again.json().suggestion.status).toBe('UNDONE');
    expect((await note(n.id)).revision).toBe(n.revision + 12);
  });

  it('resumes a keep cut short between two steps, and the undo deletes exactly the kept steps', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    // The second step's write fails once inside its transaction (a 5xx): the first step has
    // committed, the second and third have not.
    const create = Transaction.prototype.create;
    let stepWrites = 0;
    const spy = vi.spyOn(Transaction.prototype, 'create').mockImplementation(function (
      this: Transaction,
      ref,
      data,
    ) {
      if (ref.path.includes('/subtasks/') && ++stepWrites === 2) {
        spy.mockRestore();
        throw new Error('cut short');
      }
      return create.call(this, ref, data);
    } as typeof create);
    let first;
    try {
      first = await decide(fx.editToken, fx.boardId, suggestion.id, {
        decision: 'keep',
        fields: ['subtasks'],
        source: 'enter',
      });
    } finally {
      spy.mockRestore();
    }
    expect(first.statusCode).toBe(500);
    expect((await note(n.id)).subtaskSummary.total).toBe(1);
    expect((await stored(fx.editorId, suggestion.id)).status).toBe('KEPT');
    const second = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['subtasks'],
      source: 'enter',
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().suggestion.kept).toEqual({
      fields: ['subtasks'],
      subtasks: [0, 1, 2],
      revision: n.revision + 3,
    });
    const steps = (await noteDetail(fx.editToken, n.id)).subtasks;
    expect(steps.map((t) => t.text)).toEqual([
      'Unterlagen prüfen',
      'Angebot schreiben',
      'Angebot senden',
    ]);
    // The step that committed before the cut replayed its receipt: same id, one audit row.
    expect((await stored(fx.editorId, suggestion.id)).applied?.subtaskIds).toEqual(
      steps.map((t) => t.id),
    );
    const audits = await assistantAuditCol(ctx.db).where('approvalId', '==', suggestion.id).get();
    expect(audits.docs.filter((d) => d.data().commandType === 'subtask.create')).toHaveLength(3);
    const undone = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(undone.statusCode).toBe(200);
    expect((await note(n.id)).subtaskSummary.total).toBe(0);
    expect((await note(n.id)).revision).toBe(n.revision + 6);
  });

  it("a reference on the board's existing key: keep writes under that key, undo removes it again", async () => {
    const fx = await createBoardFixture(ctx);
    const other = (
      await createNote(fx.editToken, fx.boardId, {
        title: 'Alt',
        customFields: { Kunde: 'Alt GmbH' },
      })
    ).json();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    // The model said "kunde"; the board's spelling is "Kunde", and that is what is written.
    const kept = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['reference'],
      source: 'click',
    });
    expect(kept.statusCode).toBe(200);
    expect((await note(n.id)).customFields).toEqual({ Kunde: 'Müller GmbH' });
    const undone = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(undone.statusCode).toBe(200);
    expect((await note(n.id)).customFields).toEqual({});
    // The other note's value under the same key is untouched.
    expect((await note(other.id)).customFields).toEqual({ Kunde: 'Alt GmbH' });
  });

  it('a keep refused part way deletes the steps it added and puts the title back', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const record = await stored(fx.editorId, suggestion.id);
    // A keep of the title and the steps committed the title and the first step, then a
    // panel edit landed before the second step.
    const asEditor = asSuggestion(fx.editorId, fx.boardId, suggestion.id);
    await runOperation(asEditor, {
      name: 'update_note',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: n.revision,
        input: { title: 'Angebot an Müller' },
      },
      operationId: record.operationIds.title!.apply,
    });
    await runOperation(asEditor, {
      name: 'add_subtask',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: n.revision + 1,
        input: { text: 'Unterlagen prüfen' },
      },
      operationId: record.operationIds.subtasks![0]!.apply,
    });
    await assistantSuggestionsCol(ctx.db, fx.editorId)
      .doc(suggestion.id)
      .update({
        status: 'KEPT',
        decision: {
          source: 'click',
          fields: ['title', 'subtasks'],
          subtasks: [0, 1, 2],
          at: record.createdAt,
        },
      });
    await ctx.inject({
      method: 'PATCH',
      url: `/notes/${n.id}`,
      headers: ctx.authHeader(fx.editToken),
      payload: { dueDate: '2026-11-02' },
    });
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'click',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    const after = await note(n.id);
    // The person's date stays; the title and the step the keep wrote are gone again.
    expect(after).toMatchObject({ title: 'review', dueDate: '2026-11-02' });
    expect(after.subtaskSummary.total).toBe(0);
    expect((await stored(fx.editorId, suggestion.id)).status).toBe('DISCARDED');
  });

  it('refuses a step keep on a record whose operation ids predate the steps', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    await assistantSuggestionsCol(ctx.db, fx.editorId)
      .doc(suggestion.id)
      .update({ 'operationIds.subtasks': FieldValue.delete() });
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['subtasks'],
      source: 'click',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('ASSISTANT_SUGGESTION_SETTLED');
    expect((await note(n.id)).subtaskSummary.total).toBe(0);
  });

  it('an undo refused part way puts a deleted step back once, however often the undo is repeated', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const kept = (
      await decide(fx.editToken, fx.boardId, suggestion.id, {
        decision: 'keep',
        fields: ['subtasks'],
        source: 'click',
      })
    ).json().suggestion.kept;
    const record = await stored(fx.editorId, suggestion.id);
    const ids = record.applied!.subtaskIds!;
    // The undo's first inverse write (the newest step) commits, then a panel edit lands
    // before its second.
    await runOperation(asSuggestion(fx.editorId, fx.boardId, suggestion.id), {
      name: 'delete_subtask',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: kept.revision,
        subtaskId: ids[2],
      },
      operationId: record.operationIds.subtasks![2]!.undo,
    });
    expect((await patchTitle(fx.editToken, n.id, 'Danach')).statusCode).toBe(200);
    const texts = async () => (await noteDetail(fx.editToken, n.id)).subtasks.map((t) => t.text);
    const first = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'shortcut',
    });
    expect(first.statusCode).toBe(409);
    expect(first.json().error).toBe('STALE_REVISION');
    // Not half undone: the deleted step is back, under a new id.
    expect(await texts()).toEqual(['Unterlagen prüfen', 'Angebot schreiben', 'Angebot senden']);
    expect((await stored(fx.editorId, suggestion.id)).status).toBe('KEPT');
    // Each repeat replays the delete's receipt and is refused again; the step is not doubled.
    for (const source of ['esc', 'esc'] as const) {
      const revision = (await note(n.id)).revision;
      const again = await decide(fx.editToken, fx.boardId, suggestion.id, {
        decision: 'undo',
        source,
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe('STALE_REVISION');
      expect(await texts()).toEqual(['Unterlagen prüfen', 'Angebot schreiben', 'Angebot senden']);
      expect((await note(n.id)).revision).toBe(revision);
    }
    expect((await note(n.id)).subtaskSummary.total).toBe(3);
  });

  it('a kept step deleted by hand moves the revision, so the undo is refused and adds nothing', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const kept = (
      await decide(fx.editToken, fx.boardId, suggestion.id, {
        decision: 'keep',
        fields: ['subtasks'],
        source: 'click',
      })
    ).json().suggestion.kept;
    expect((await note(n.id)).revision).toBe(kept.revision);
    const steps = (await noteDetail(fx.editToken, n.id)).subtasks;
    const removed = await ctx.inject({
      method: 'DELETE',
      url: `/notes/${n.id}/subtasks/${steps[0]!.id}`,
      headers: ctx.authHeader(fx.editToken),
    });
    expect(removed.statusCode).toBe(204);
    expect((await note(n.id)).revision).toBe(kept.revision + 1);
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    expect((await noteDetail(fx.editToken, n.id)).subtasks.map((t) => t.text)).toEqual([
      'Angebot schreiben',
      'Angebot senden',
    ]);
    expect((await note(n.id)).revision).toBe(kept.revision + 1);
    expect((await stored(fx.editorId, suggestion.id)).status).toBe('KEPT');
  });

  it("undo puts a reference key's previous value back when the key held one", async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['reference'],
      source: 'click',
    });
    expect((await note(n.id)).customFields).toEqual({ kunde: 'Müller GmbH' });
    // No route reaches this state: a reference is proposed only on a note with no property
    // (R7), and one set later makes the keep stale. The record is edited to hold a previous
    // value, so the restore branch of R8 runs through the real undo.
    await assistantSuggestionsCol(ctx.db, fx.editorId)
      .doc(suggestion.id)
      .update({ 'applied.before.reference.previous': 'Alt GmbH' });
    const undone = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(undone.statusCode).toBe(200);
    expect((await note(n.id)).customFields).toEqual({ kunde: 'Alt GmbH' });
    const audits = await assistantAuditCol(ctx.db).where('approvalId', '==', suggestion.id).get();
    expect(audits.docs.map((d) => d.data().commandType)).toEqual(['note.update', 'note.update']);
  });

  // These run as the viewer, on private notes: the owner and the editor already come close to
  // the route's per-user rate limit of 30 captures a minute in this file.

  it('a countdown keep of a title-only proposal is refused once undone, and replays a discard', async () => {
    const fx = await createBoardFixture(ctx);
    const own = async (title: string) =>
      (await createNote(fx.viewToken, fx.boardId, { title, visibility: 'PRIVATE' })).json();
    const n = await own('titleonly');
    const { suggestion } = (await suggest(fx.viewToken, fx.boardId, n.id)).json();
    const kept = await decide(fx.viewToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['title'],
      source: 'click',
    });
    expect(kept.json().suggestion.kept.fields).toEqual(['title']);
    const undone = await decide(fx.viewToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'click',
    });
    expect(undone.json().suggestion.status).toBe('UNDONE');
    // A countdown that fires late on the undone record is settled, not "left waiting".
    const late = await decide(fx.viewToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'countdown',
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe('ASSISTANT_SUGGESTION_SETTLED');
    expect((await stored(fx.viewerId, suggestion.id)).status).toBe('UNDONE');
    expect(await note(n.id)).toMatchObject({ title: 'titleonly', revision: n.revision + 2 });

    // On a discarded one it is a keep of nothing, which replays the discard.
    const other = await own('titleonly zwei');
    const second = (await suggest(fx.viewToken, fx.boardId, other.id)).json().suggestion;
    await decide(fx.viewToken, fx.boardId, second.id, { decision: 'discard', source: 'esc' });
    const fired = await decide(fx.viewToken, fx.boardId, second.id, {
      decision: 'keep',
      source: 'countdown',
    });
    expect(fired.statusCode).toBe(200);
    expect(fired.json().suggestion).toMatchObject({ status: 'DISCARDED', kept: null });
    expect((await note(other.id)).revision).toBe(other.revision);
  });

  it('reads no board keys for a note that has a property already: the prompt lists none', async () => {
    const fx = await createBoardFixture(ctx);
    await createNote(fx.editToken, fx.boardId, { title: 'Alt', customFields: { Kunde: 'Alt' } });
    const n = (
      await createNote(fx.viewToken, fx.boardId, {
        title: 'Freitag',
        visibility: 'PRIVATE',
        customFields: { Projekt: 'X' },
      })
    ).json();
    const s = (await suggest(fx.viewToken, fx.boardId, n.id)).json().suggestion;
    expect(s.fields).toMatchObject({ dueDate: { value: '2026-10-23' }, reference: null });
    // No reference can be proposed, so the board's keys are never read for the prompt.
    expect(lastInput?.prompt).toContain('Properties on this board: none');
    expect(lastInput?.prompt).not.toContain('Kunde');
  });

  it("records as typed only the chips' fields, each once", async () => {
    const fx = await createBoardFixture(ctx);
    const n = (
      await createNote(fx.viewToken, fx.boardId, { title: 'all nobody', visibility: 'PRIVATE' })
    ).json();
    const res = await suggest(fx.viewToken, fx.boardId, n.id, ['title', 'dueDate', 'dueDate']);
    expect(res.statusCode).toBe(200);
    const { suggestion } = res.json();
    expect(suggestion.fields).toMatchObject({ dueDate: null, priority: { value: 'HOCH' } });
    expect(suggestion.typed).toEqual(['dueDate']);
    expect((await stored(fx.viewerId, suggestion.id)).typed).toEqual(['dueDate']);
  });
});
