import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  SuggestionInput,
  SuggestionOutput,
  SuggestionRunner,
} from '../src/lib/assistant/model/index.js';
import {
  assistantAttemptsCol,
  assistantAuditCol,
  assistantSuggestionsCol,
  assistantUsageCol,
  notesCol,
} from '../src/lib/db/collections.js';
import { dayKey, reserveAttempt } from '../src/lib/assistant/budget/ledger.js';
import { estimateTokens } from '../src/lib/assistant/budget/estimate.js';
import { suggestionSchemaJson } from '../src/lib/assistant/model/index.js';
import { modelSuggestionSchema } from '../src/lib/assistant/model/suggest.js';
import { FieldValue, Timestamp, Transaction } from 'firebase-admin/firestore';
import { runOperation, type OperationContext } from '../src/lib/assistant/run.js';
import {
  addTestMember,
  buildTestApp,
  createBoardFixture,
  registerTestUser,
  resetDatabase,
  type TestContext,
} from './helpers.js';

const PROJECT_ID = 'wally-test-assistant-suggestions';
const usage = { inputTokens: 50, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 };

/** The prompts that already failed once with "busy" (the `flaky` titles). */
const flakySeen = new Set<string>();
/** The last prompt the fake saw, so a test can assert what reached the model. */
let lastInput: SuggestionInput | null = null;

/** The fields beyond date, priority and person, which these replies propose nothing for. */
const noProposal = {
  title: null,
  subtasks: null,
  links: null,
  horizon: null,
  visibility: null,
  tags: null,
  properties: null,
  description: null,
};
/**
 * Keyed on the title line: the fake answers like a model would, and its reply gets the one
 * check a real runner's reply gets, so the route sees what a runner hands over.
 */
const fakeRunner: SuggestionRunner = async (input): Promise<SuggestionOutput> => {
  lastInput = input;
  const lease = await input.onAttempt({ stepNumber: 0, messageCount: 1, maxOutputTokens: 256 });
  const title = input.prompt.split('\n')[0]!.slice('Title: '.length);
  // The reply as a model sends it, checked like a real runner's: unknown keys drop, absent
  // optional fields read as nothing proposed.
  const settle = async (fields: Record<string, unknown>): Promise<SuggestionOutput> => {
    await lease.settle(usage);
    const checked = modelSuggestionSchema.safeParse(fields);
    return { fields: checked.success ? checked.data : null, usage, finishReason: 'stop' };
  };
  // Busy once, then answers: the call is retried once after a short pause.
  if (title.startsWith('flaky') && !flakySeen.has(input.prompt)) {
    flakySeen.add(input.prompt);
    throw Object.assign(new Error('busy'), { name: 'AI_APICallError', statusCode: 429 });
  }
  if (title.startsWith('flaky'))
    return settle({
      dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Friday' },
      priority: null,
      assignee: null,
      ...noProposal,
    });
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
      dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Friday' },
      priority: { value: 'HOCH', confidence: 0.8, reason: 'urgent' },
      assignee: { memberId, confidence: 0.95, reason: 'Anna' },
      ...noProposal,
    });
  }
  // The provider reported no usage: nothing is settled, so the reservation stays (R7).
  if (title.startsWith('unknown'))
    return {
      fields: {
        dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Friday' },
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
      dueDate: { value: '2026-10-01', confidence: 0.9, reason: 'early October' },
      priority: null,
      assignee: null,
      ...noProposal,
    });
  // Slice 3: a cleaner title, a property and three steps beside a date.
  if (title.startsWith('review'))
    return settle({
      dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Friday' },
      priority: null,
      assignee: null,
      title: { value: 'Quote for Müller', confidence: 0.8, reason: 'shorter' },
      properties: {
        items: [{ key: 'customer', value: 'Müller GmbH' }],
        confidence: 0.9,
        reason: 'customer named',
      },
      subtasks: {
        items: ['Check the documents', 'Write the quote', 'Send the quote'],
        confidence: 0.8,
        reason: 'three steps',
      },
      links: null,
    });
  // A "cleaner" title that is the note's own: nothing to offer.
  if (title.startsWith('sametitle'))
    return settle({
      dueDate: null,
      priority: null,
      assignee: null,
      title: { value: 'sametitle', confidence: 0.9, reason: 'same' },
      reference: null,
      subtasks: null,
      links: null,
    });
  // A key the property schema refuses, and steps that are doubled or blank.
  if (title.startsWith('badref'))
    return settle({
      dueDate: null,
      priority: null,
      assignee: null,
      title: null,
      properties: {
        items: [{ key: 'Cust.omer', value: 'x' }],
        confidence: 0.9,
        reason: 'dot in the name',
      },
      subtasks: { items: ['a', 'a', ' '], confidence: 0.9, reason: 'doubled' },
      links: null,
    });
  // Doubled and blank steps beside two real ones: the two survive, in order.
  if (title.startsWith('dupsteps'))
    return settle({
      dueDate: null,
      priority: null,
      assignee: null,
      title: null,
      reference: null,
      subtasks: { items: [' a', 'a', ' ', 'b '], confidence: 0.9, reason: 'doubled' },
      links: null,
    });
  // Smarter capture: a horizon, three tags, two properties, a title and its description.
  if (title.startsWith('smart'))
    return settle({
      dueDate: null,
      priority: null,
      assignee: null,
      title: { value: 'Smart note', confidence: 0.9, reason: 'shorter' },
      description: { value: 'The detail.', confidence: 0.9, reason: 'moved out' },
      horizon: { value: 'DIESE_WOCHE', confidence: 0.9, reason: '"this week"' },
      tags: { items: ['ops', 'sales', 'travel'], confidence: 0.9, reason: 'board tags' },
      properties: {
        items: [
          { key: 'Customer', value: 'Acme' },
          { key: 'Project', value: 'Relaunch' },
        ],
        confidence: 0.9,
        reason: 'named',
      },
    });
  // Private beside tags, and Private beside a horizon: for the revert paths of the pair.
  if (title.startsWith('privtags') || title.startsWith('privwhen'))
    return settle({
      dueDate: null,
      priority: null,
      assignee: null,
      ...noProposal,
      visibility: { value: 'PRIVATE', confidence: 0.9, reason: 'personal' },
      ...(title.startsWith('privtags')
        ? { tags: { items: ['ops'], confidence: 0.9, reason: 'board tag' } }
        : { horizon: { value: 'DIESE_WOCHE', confidence: 0.9, reason: 'this week' } }),
    });
  // A personal matter: Private (opt-in) beside a date, and a person that Private drops.
  if (title.startsWith('private'))
    return settle({
      dueDate: title.includes('dated')
        ? { value: '2026-10-23', confidence: 0.9, reason: 'Friday' }
        : null,
      priority: null,
      assignee: { memberId: 'fx-owner', confidence: 0.9, reason: 'named' },
      ...noProposal,
      visibility: { value: 'PRIVATE', confidence: 0.9, reason: 'a dentist visit' },
    });
  // A cleaner title and nothing else.
  if (title.startsWith('titleonly'))
    return settle({
      dueDate: null,
      priority: null,
      assignee: null,
      title: { value: 'Just a title', confidence: 0.9, reason: 'shorter' },
      reference: null,
      subtasks: null,
      links: null,
    });
  // Links: the first row of the prompt's "Other notes" block is the note to relate, named
  // twice, beside an id that is not on the board.
  if (title.startsWith('related')) {
    const block = input.prompt.split('Other notes on this board:\n')[1] ?? '';
    const ids = block
      .split('\n')
      .map((line) => line.split(': ')[0]!)
      .filter(Boolean);
    return settle({
      dueDate: null,
      priority: null,
      assignee: null,
      title: null,
      reference: null,
      subtasks: null,
      links: {
        items: [
          { noteId: ids[0] ?? 'none', reason: 'same customer' },
          { noteId: ids[0] ?? 'none', reason: 'twice' },
          { noteId: 'not-on-board', reason: 'invented' },
        ],
        confidence: 0.9,
        reason: 'related',
      },
    });
  }
  // Three links at once: the first three rows of the "Other notes" block, newest first; with
  // `dated` in the title, a due date beside them.
  if (title.startsWith('threelinks')) {
    const block = input.prompt.split('Other notes on this board:\n')[1] ?? '';
    const ids = block
      .split('\n')
      .map((line) => line.split(': ')[0]!)
      .filter(Boolean)
      .slice(0, 3);
    return settle({
      dueDate: title.includes('dated')
        ? { value: '2026-10-23', confidence: 0.9, reason: 'Friday' }
        : null,
      priority: null,
      assignee: null,
      title: null,
      reference: null,
      subtasks: null,
      links: {
        items: ids.map((noteId) => ({ noteId, reason: `related to ${noteId}` })),
        confidence: 0.9,
        reason: 'related',
      },
    });
  }
  if (title.startsWith('unsure'))
    return settle({
      dueDate: { value: '2026-10-23', confidence: 0.3, reason: 'maybe' },
      priority: null,
      assignee: null,
      ...noProposal,
    });
  return settle({
    dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Friday' },
    priority: null,
    assignee: null,
    ...noProposal,
  });
};

/**
 * The capture's log line says why "nothing came": which fields were open, which rule kept or
 * dropped each proposed field, and the early exits, by name only, never the note's words.
 */
describe('the capture log line', () => {
  let ctx: TestContext;
  const lines: string[] = [];
  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID, {
      suggestionRunner: fakeRunner,
      assistantEnabled: true,
      logLines: lines,
    });
  });
  afterEach(async () => {
    lines.length = 0;
    await resetDatabase(PROJECT_ID);
  });
  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });
  const captureLog = () =>
    lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.type === 'assistant.capture');

  it('names the outcome of each proposed field and whether anything was stored, without the words', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { title: 'all u-stranger secretword' },
      })
    ).json();
    await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/assistant/captures`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: {
        noteId: n.id,
        locked: ['priority'],
        timeZone: 'Europe/Berlin',
        today: '2026-10-17',
      },
    });
    const [entry] = captureLog();
    expect(entry).toMatchObject({
      noteId: n.id,
      proposed: true,
      stored: true,
      locked: ['priority'],
      outcomes: { dueDate: 'kept', priority: 'not_open', assignee: 'not_member' },
    });
    expect(entry!.open).toEqual(expect.arrayContaining(['dueDate', 'assignee']));
    expect(lines.join('')).not.toContain('secretword');
  });

  it('says when it skipped the model because nothing was left to suggest', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { title: 'nothing here' },
      })
    ).json();
    await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/assistant/captures`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: {
        noteId: n.id,
        locked: [
          'dueDate',
          'priority',
          'assignee',
          'title',
          'subtasks',
          'links',
          'horizon',
          'visibility',
          'tags',
          'properties',
          'description',
          'reference',
        ],
        timeZone: 'Europe/Berlin',
        today: '2026-10-17',
      },
    });
    expect(captureLog()).toEqual([
      expect.objectContaining({ noteId: n.id, skipped: 'nothing_open' }),
    ]);
  });
});

describe('a capture whose model is busy or slow', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await buildTestApp(PROJECT_ID, { suggestionRunner: fakeRunner, assistantEnabled: true });
  });
  afterEach(async () => {
    flakySeen.clear();
    await resetDatabase(PROJECT_ID);
  });
  afterAll(async () => {
    await resetDatabase(PROJECT_ID);
    await ctx.app.close();
  });
  const captureOf = async (title: string, app: TestContext = ctx) => {
    const fx = await createBoardFixture(app);
    const n = (
      await app.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: app.authHeader(fx.ownerToken),
        payload: { title },
      })
    ).json();
    const res = await app.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/assistant/captures`,
      headers: app.authHeader(fx.ownerToken),
      payload: { noteId: n.id, locked: [], timeZone: 'Europe/Berlin', today: '2026-10-17' },
    });
    return { res, fx };
  };

  it('asks once more after a busy answer, and the person gets the suggestion', async () => {
    const { res, fx } = await captureOf('flaky invoice');
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.fields.dueDate).toEqual({ value: '2026-10-23', reason: 'Friday' });
    // Each attempt reserved on its own: the busy one (which this fake reports without usage)
    // keeps its charge but not its slot, and the answer's was settled.
    const usageDoc = (
      await assistantUsageCol(ctx.db, fx.ownerId).doc(dayKey(new Date())).get()
    ).data();
    expect(usageDoc?.inFlight).toEqual({});
    expect(usageDoc?.tokens).toBeGreaterThan(usage.inputTokens + usage.outputTokens);
  });

  it('frees the busy attempt before the retry, so a call elsewhere does not make it busy', async () => {
    const fx = await createBoardFixture(ctx);
    // A question of the same person's holds the other of their two slots meanwhile.
    await reserveAttempt(ctx.db, {
      userId: fx.ownerId,
      now: new Date(),
      estimate: { inputTokens: 10, outputTokens: 10 },
      price: null,
      caps: { dailyTokens: 1_000_000, monthlyMicroUsd: 1_000_000 },
    });
    const n = (
      await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.ownerToken),
        payload: { title: 'flaky invoice' },
      })
    ).json();
    const res = await ctx.inject({
      method: 'POST',
      url: `/whiteboards/${fx.boardId}/assistant/captures`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { noteId: n.id, locked: [], timeZone: 'Europe/Berlin', today: '2026-10-17' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.fields.dueDate).toMatchObject({ value: '2026-10-23' });
  });

  it('answers 504 ASSISTANT_TIMEOUT, retryable, when the model runs past the deadline, and frees its slot', async () => {
    const slow: SuggestionRunner = async (input) => {
      await input.onAttempt({ stepNumber: 0, messageCount: 1, maxOutputTokens: 256 });
      return new Promise((_resolve, reject) =>
        input.abortSignal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      );
    };
    const app = await buildTestApp(PROJECT_ID, {
      suggestionRunner: slow,
      assistantEnabled: true,
      assistantDeadlineMs: 50,
    });
    try {
      const { res, fx } = await captureOf('slow note', app);
      expect(res.statusCode).toBe(504);
      expect(res.json()).toMatchObject({ error: 'ASSISTANT_TIMEOUT', retryable: true });
      // The call never reported usage: its worst case stays charged, its slot is free at once.
      const usageDoc = (
        await assistantUsageCol(app.db, fx.ownerId).doc(dayKey(new Date())).get()
      ).data();
      expect(usageDoc?.inFlight).toEqual({});
      expect(usageDoc?.tokens).toBeGreaterThan(256);
      const attempts = await assistantAttemptsCol(app.db, fx.ownerId).get();
      expect(attempts.docs.map((d) => d.data().state)).toEqual(['ABANDONED']);
    } finally {
      await app.app.close();
    }
  });
});

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
  const patchNote = (token: string, noteId: string, body: Record<string, unknown>) =>
    ctx.inject({
      method: 'PATCH',
      url: `/notes/${noteId}`,
      headers: ctx.authHeader(token),
      payload: body,
    });
  const patchTitle = (token: string, noteId: string, title: string) =>
    patchNote(token, noteId, { title });
  /** The audit rows the caller's assistant writes left: one per committed write. */
  const audits = async (actorId: string) =>
    (await assistantAuditCol(ctx.db).where('actorId', '==', actorId).get()).size;
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
  /**
   * A board with one more editor who writes the smarter-capture tests' notes: the capture
   * route allows 30 calls a minute per person, and the fixture's owner and editor already
   * come close to it in this file.
   */
  const smartBoard = async () => {
    const fx = await createBoardFixture(ctx);
    const token = registerTestUser(ctx, 'fx-smart', 'smart@fixture.de', 'Smart');
    await ctx.app.inject({ method: 'GET', url: '/whiteboards', headers: ctx.authHeader(token) });
    await addTestMember(ctx.db, fx.boardId, 'fx-smart', 'EDIT');
    return { ...fx, editToken: token, editorId: 'fx-smart' };
  };

  it('proposes the fields the note leaves empty and reserves then settles the call', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (
      await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor urgent' })
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
        dueDate: { value: '2026-10-23', reason: 'Friday' },
        priority: { value: 'HOCH', reason: 'urgent' },
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
    expect(lastInput?.prompt).toContain('Title: all fx-editor urgent');
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
        customFields: { Project: 'X' },
        horizon: 'DIESE_WOCHE',
        tags: ['ops'],
        description: 'Written already.',
      })
    ).json();
    await ctx.inject({
      method: 'POST',
      url: `/notes/${n.id}/subtasks`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { text: 'Step' },
    });
    // Every field is filled, the note has a property, a tag and a step, the title was the
    // person's own decision, and the board has no other note to link.
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
      await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor urgent' })
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
      links: [],
      tags: [],
      properties: [],
      revision: n.revision + 3,
    });
  });

  it('reads a proposed link with its target current title, and drops a target gone from the board', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const renamed = (await createNote(fx.ownerToken, fx.boardId, { title: 'Quote' })).json();
    const deleted = (await createNote(fx.ownerToken, fx.boardId, { title: 'Old' })).json();
    const elsewhere = (
      await createNote(fx.editToken, 'fx-editor', { title: 'Other board' })
    ).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    await assistantSuggestionsCol(ctx.db, fx.ownerId)
      .doc(suggestion.id)
      .update({
        'fields.links': {
          items: [
            { noteId: renamed.id, reason: 'same customer' },
            { noteId: deleted.id, reason: 'same topic' },
            { noteId: elsewhere.id, reason: 'same words' },
            { noteId: 'no-such-note', reason: 'never existed' },
          ],
          reason: 'related',
        },
      });
    await patchTitle(fx.ownerToken, renamed.id, 'Quote for Müller');
    await notesCol(ctx.db).doc(deleted.id).update({ deletedAt: Timestamp.now() });
    const read = await pending(fx.ownerToken, fx.boardId);
    expect(read.statusCode).toBe(200);
    expect(read.json().suggestions[0].fields.links).toEqual({
      items: [{ index: 0, noteId: renamed.id, title: 'Quote for Müller', reason: 'same customer' }],
      reason: 'related',
    });
    // With every target gone the field reads as nothing proposed.
    await notesCol(ctx.db).doc(renamed.id).update({ deletedAt: Timestamp.now() });
    const empty = await pending(fx.ownerToken, fx.boardId);
    expect(empty.json().suggestions[0].fields.links).toBeNull();
  });

  it('numbers each readable link by its stored index when targets dropped out, and hides a target another member made private', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'all fx-editor' })).json();
    const a = (await createNote(fx.ownerToken, fx.boardId, { title: 'A' })).json();
    const b = (await createNote(fx.ownerToken, fx.boardId, { title: 'B' })).json();
    const c = (await createNote(fx.ownerToken, fx.boardId, { title: 'C' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    const proposeLinks = (...ids: string[]) =>
      assistantSuggestionsCol(ctx.db, fx.ownerId)
        .doc(suggestion.id)
        .update({
          'fields.links': {
            items: ids.map((noteId) => ({ noteId, reason: `why ${noteId}` })),
            reason: 'related',
          },
        });
    const readLinks = async () =>
      (await pending(fx.ownerToken, fx.boardId)).json().suggestions[0].fields.links;

    // The first target is gone: B and C keep stored indexes 1 and 2, not 0 and 1.
    await proposeLinks(a.id, b.id, c.id);
    await notesCol(ctx.db).doc(a.id).update({ deletedAt: Timestamp.now() });
    expect((await readLinks()).items).toEqual([
      { index: 1, noteId: b.id, title: 'B', reason: `why ${b.id}` },
      { index: 2, noteId: c.id, title: 'C', reason: `why ${c.id}` },
    ]);

    // A target another member turns private after the proposal is not shown to the owner, title
    // included; the others keep their stored indexes.
    const theirs = (await createNote(fx.editToken, fx.boardId, { title: 'Secret plans' })).json();
    await proposeLinks(b.id, theirs.id, c.id);
    expect((await readLinks()).items.map((i: { index: number }) => i.index)).toEqual([0, 1, 2]);
    await notesCol(ctx.db)
      .doc(theirs.id)
      .update({ visibility: 'PRIVATE', assigneeId: fx.editorId });
    const hidden = await readLinks();
    expect(hidden.items).toEqual([
      { index: 0, noteId: b.id, title: 'B', reason: `why ${b.id}` },
      { index: 2, noteId: c.id, title: 'C', reason: `why ${c.id}` },
    ]);
    expect(JSON.stringify(hidden)).not.toContain('Secret plans');

    // A note the owner made private is still theirs to see.
    const mine = (await createNote(fx.ownerToken, fx.boardId, { title: 'Mine' })).json();
    await proposeLinks(mine.id);
    await notesCol(ctx.db).doc(mine.id).update({ visibility: 'PRIVATE', assigneeId: fx.ownerId });
    expect((await readLinks()).items).toEqual([
      { index: 0, noteId: mine.id, title: 'Mine', reason: `why ${mine.id}` },
    ]);

    // Only private targets of others left: the field reads as nothing proposed.
    await proposeLinks(theirs.id);
    expect(await readLinks()).toBeNull();
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
    expect(res.json()).toEqual({
      error: 'ASSISTANT_PROVIDER_ERROR',
      message: expect.any(String),
      retryable: true,
    });
    expect(JSON.stringify(res.json())).not.toContain('secret-project');
    expect((await assistantSuggestionsCol(ctx.db, fx.ownerId).get()).size).toBe(0);
    // This fake fails without usage, as a dropped connection does: the call and its one retry
    // each stay charged (R7), but neither holds a slot once the capture has answered.
    expect(await inFlight(fx.ownerId)).toBe(0);
    const attempts = await assistantAttemptsCol(ctx.db, fx.ownerId).get();
    expect(attempts.docs.map((d) => d.data().state)).toEqual(['ABANDONED', 'ABANDONED']);
  });

  it('keeps the charge but frees the slot when the provider reports no usage', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'unknown Friday' })).json();
    const res = await suggest(fx.ownerToken, fx.boardId, n.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.fields.dueDate).toMatchObject({ value: '2026-10-23' });
    expect(await inFlight(fx.ownerId)).toBe(0);
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
      links: [],
      tags: [],
      properties: [],
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
      links: [],
      tags: [],
      properties: [],
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
      payload: { title: 'Changed' },
    });
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'countdown',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    expect(await note(n.id)).toMatchObject({
      title: 'Changed',
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
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'Friday' })).json();
    const { suggestion } = (await suggest(fx.ownerToken, fx.boardId, n.id)).json();
    await decide(fx.ownerToken, fx.boardId, suggestion.id, { decision: 'keep', source: 'enter' });
    await ctx.inject({
      method: 'PATCH',
      url: `/notes/${n.id}`,
      headers: ctx.authHeader(fx.ownerToken),
      payload: { title: 'Afterwards' },
    });
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    expect(await note(n.id)).toMatchObject({ title: 'Afterwards', dueDate: '2026-10-23' });
    const stored = (
      await assistantSuggestionsCol(ctx.db, fx.ownerId).doc(suggestion.id).get()
    ).data()!;
    expect(stored.status).toBe('KEPT');
  });

  it('discards without touching the note, and a keep after that is refused', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'Friday' })).json();
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
    const a = (await createNote(fx.ownerToken, fx.boardId, { title: 'Friday a' })).json();
    const b = (await createNote(fx.ownerToken, fx.boardId, { title: 'Friday b' })).json();
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
    const fresh = await make('Friday fresh');
    const gone = await make('Friday gone');
    const moved = await make('Friday moved');
    const old = await make('Friday old');
    expect(
      (
        await ctx.inject({
          method: 'DELETE',
          url: `/notes/${gone.note.id}`,
          headers: ctx.authHeader(fx.editToken),
        })
      ).statusCode,
    ).toBeLessThan(300);
    expect((await patchTitle(fx.editToken, moved.note.id, 'Friday, changed')).statusCode).toBe(200);
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
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'Friday kept' })).json();
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
      await createNote(fx.viewToken, fx.boardId, { title: 'Friday', visibility: 'PRIVATE' })
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
    const n = (await createNote(fx.ownerToken, fx.boardId, { title: 'Friday' })).json();
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
      links: [],
      tags: [],
      properties: [],
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
    expect((await patchTitle(fx.ownerToken, n.id, 'Changed')).statusCode).toBe(200);
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    // The due date the keep wrote is gone again; the person's edit stays.
    const after = await note(n.id);
    expect(after).toMatchObject({
      title: 'Changed',
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
    expect((await patchTitle(fx.ownerToken, n.id, 'Afterwards')).statusCode).toBe(200);
    const res = await decide(fx.ownerToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'shortcut',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    // Not half undone: the assignee the undo removed is back, beside the person's edit.
    expect(await note(n.id)).toMatchObject({
      title: 'Afterwards',
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

  it("proposes a title, a property under the board's own key, and steps, and records what was typed", async () => {
    const fx = await createBoardFixture(ctx);
    // The board already uses "Customer"; the model answers with "customer".
    await createNote(fx.editToken, fx.boardId, {
      title: 'Old',
      customFields: { Customer: 'Old GmbH' },
    });
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const res = await suggest(fx.editToken, fx.boardId, n.id, ['priority']);
    expect(res.statusCode).toBe(200);
    const { suggestion } = res.json();
    expect(suggestion.typed).toEqual(['priority']);
    expect(suggestion.fields).toMatchObject({
      dueDate: { value: '2026-10-23' },
      priority: null,
      title: { value: 'Quote for Müller', reason: 'shorter' },
      reference: null,
      properties: {
        items: [{ key: 'Customer', value: 'Müller GmbH' }],
        reason: 'customer named',
      },
      subtasks: {
        items: ['Check the documents', 'Write the quote', 'Send the quote'],
        reason: 'three steps',
      },
    });
    expect(lastInput?.prompt).toContain('Properties on this board:\nCustomer');
    expect(lastInput?.maxOutputTokens).toBe(1024);
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

  it('the countdown keeps the cleaned title with the rest, and a title alone too', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['dueDate', 'title', 'subtasks', 'properties'],
      source: 'countdown',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.kept.fields).toEqual([
      'dueDate',
      'title',
      'subtasks',
      'properties',
    ]);
    expect(await note(n.id)).toMatchObject({ title: 'Quote for Müller', dueDate: '2026-10-23' });

    const only = (await createNote(fx.editToken, fx.boardId, { title: 'titleonly' })).json();
    const proposal = (await suggest(fx.editToken, fx.boardId, only.id)).json().suggestion;
    const fired = await decide(fx.editToken, fx.boardId, proposal.id, {
      decision: 'keep',
      source: 'countdown',
    });
    expect(fired.json().suggestion.kept.fields).toEqual(['title']);
    expect((await note(only.id)).title).toBe('Just a title');
  });

  it('never proposes a reference or steps on a note that has them, nor a title that was locked', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (
      await createNote(fx.editToken, fx.boardId, {
        title: 'review',
        customFields: { Project: 'X' },
      })
    ).json();
    await ctx.inject({
      method: 'POST',
      url: `/notes/${n.id}/subtasks`,
      headers: ctx.authHeader(fx.editToken),
      payload: { text: 'Step' },
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

  it("keeps a subset: the date, the property and one of three steps; the title stays the person's", async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['dueDate', 'subtasks', 'properties'],
      subtasks: [1],
      source: 'click',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestion.kept).toEqual({
      fields: ['dueDate', 'subtasks', 'properties'],
      subtasks: [1],
      links: [],
      tags: [],
      properties: [0],
      revision: n.revision + 3,
    });
    const after = await note(n.id);
    expect(after).toMatchObject({ title: 'review', dueDate: '2026-10-23' });
    // No other note on this board uses the key, so it is written as the model spelled it.
    expect(after.customFields).toEqual({ customer: 'Müller GmbH' });
    expect(after.subtaskSummary).toEqual({ total: 1, done: 0 });
    expect((await noteDetail(fx.editToken, n.id)).subtasks.map((t) => t.text)).toEqual([
      'Write the quote',
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
      links: [],
      tags: [],
      properties: [],
      revision: n.revision + 1,
    });
    expect((await note(n.id)).subtaskSummary.total).toBe(0);
  });

  it('refuses a keep once a property was set on the note after the proposal', async () => {
    const fx = await createBoardFixture(ctx);
    await createNote(fx.editToken, fx.boardId, {
      title: 'Old',
      customFields: { Customer: 'Old GmbH' },
    });
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    // The proposal was for a note without properties; one set since makes the keep stale,
    // so a reference never overwrites a value the person wrote.
    await ctx.inject({
      method: 'PATCH',
      url: `/notes/${n.id}`,
      headers: ctx.authHeader(fx.editToken),
      payload: { fieldChanges: { set: { Customer: 'Interim' } } },
    });
    const stale = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'enter',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('STALE_REVISION');
    const after = await note(n.id);
    expect(after).toMatchObject({ title: 'review', dueDate: null });
    expect(after.customFields).toEqual({ Customer: 'Interim' });
    expect(after.subtaskSummary.total).toBe(0);
  });

  it('undo after a full keep restores the title, removes the property and deletes every step, once', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const kept = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['dueDate', 'title', 'subtasks', 'properties'],
      source: 'click',
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().suggestion.kept).toEqual({
      fields: ['dueDate', 'title', 'subtasks', 'properties'],
      subtasks: [0, 1, 2],
      links: [],
      tags: [],
      properties: [0],
      revision: n.revision + 6,
    });
    const keptNote = await note(n.id);
    expect(keptNote).toMatchObject({ title: 'Quote for Müller' });
    expect(keptNote.customFields).toEqual({ customer: 'Müller GmbH' });
    const steps = (await noteDetail(fx.editToken, n.id)).subtasks;
    expect(steps.map((t) => t.text)).toEqual([
      'Check the documents',
      'Write the quote',
      'Send the quote',
    ]);
    const record = await stored(fx.editorId, suggestion.id);
    expect(record.applied).toMatchObject({
      before: { title: 'review' },
      properties: [0],
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
      links: [],
      tags: [],
      properties: [],
      revision: n.revision + 3,
    });
    const steps = (await noteDetail(fx.editToken, n.id)).subtasks;
    expect(steps.map((t) => t.text)).toEqual([
      'Check the documents',
      'Write the quote',
      'Send the quote',
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

  it("a property on the board's existing key: keep writes under that key, undo removes it again", async () => {
    const fx = await createBoardFixture(ctx);
    const other = (
      await createNote(fx.editToken, fx.boardId, {
        title: 'Old',
        customFields: { Customer: 'Old GmbH' },
      })
    ).json();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'review' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    // The model said "customer"; the board's spelling is "Customer", and that is what is written.
    const kept = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['properties'],
      source: 'click',
    });
    expect(kept.statusCode).toBe(200);
    expect((await note(n.id)).customFields).toEqual({ Customer: 'Müller GmbH' });
    const undone = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(undone.statusCode).toBe(200);
    expect((await note(n.id)).customFields).toEqual({});
    // The other note's value under the same key is untouched.
    expect((await note(other.id)).customFields).toEqual({ Customer: 'Old GmbH' });
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
        input: { title: 'Quote for Müller' },
      },
      operationId: record.operationIds.title!.apply,
    });
    await runOperation(asEditor, {
      name: 'add_subtask',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: n.revision + 1,
        input: { text: 'Check the documents' },
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
    expect((await patchTitle(fx.editToken, n.id, 'Afterwards')).statusCode).toBe(200);
    const texts = async () => (await noteDetail(fx.editToken, n.id)).subtasks.map((t) => t.text);
    const first = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'shortcut',
    });
    expect(first.statusCode).toBe(409);
    expect(first.json().error).toBe('STALE_REVISION');
    // Not half undone: the deleted step is back, under a new id.
    expect(await texts()).toEqual(['Check the documents', 'Write the quote', 'Send the quote']);
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
      expect(await texts()).toEqual(['Check the documents', 'Write the quote', 'Send the quote']);
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
      'Write the quote',
      'Send the quote',
    ]);
    expect((await note(n.id)).revision).toBe(kept.revision + 1);
    expect((await stored(fx.editorId, suggestion.id)).status).toBe('KEPT');
  });

  it('a pending record stored before this release (reference, no new fields) still reads, keeps its property and undoes it', async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'legacy' })).json();
    // Written as the release before smarter capture stored it: one reference, none of the
    // new fields, and the operation ids of that release.
    const now = Timestamp.now();
    const ids = () => ({ apply: crypto.randomUUID(), undo: crypto.randomUUID() });
    const ref = assistantSuggestionsCol(ctx.db, fx.editorId).doc();
    await ref.set({
      boardId: fx.boardId,
      noteId: n.id,
      baseRevision: n.revision,
      fields: {
        dueDate: null,
        priority: null,
        assignee: null,
        title: null,
        reference: { key: 'Customer', value: 'Acme', reason: 'named' },
        subtasks: null,
        links: null,
      },
      typed: [],
      operationIds: {
        dueDate: ids(),
        priority: ids(),
        assignee: ids(),
        title: ids(),
        reference: ids(),
        subtasks: [ids(), ids(), ids(), ids(), ids()],
        links: ids(),
      },
      status: 'PENDING',
      decision: null,
      undone: null,
      applied: null,
      model: 'vertex:gemini-2.5-flash',
      usage: { inputTokens: 1, outputTokens: 1 },
      createdAt: now,
      updatedAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 86_400_000),
    });
    const listed = (await pending(fx.editToken, fx.boardId)).json().suggestions;
    expect(listed).toHaveLength(1);
    expect(listed[0].fields).toMatchObject({
      reference: { key: 'Customer', value: 'Acme' },
      horizon: null,
      visibility: null,
      tags: null,
      properties: null,
      description: null,
    });
    const kept = await decide(fx.editToken, fx.boardId, ref.id, {
      decision: 'keep',
      source: 'countdown',
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().suggestion.kept.fields).toEqual(['reference']);
    expect((await note(n.id)).customFields).toEqual({ Customer: 'Acme' });
    const undone = await decide(fx.editToken, fx.boardId, ref.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(undone.statusCode).toBe(200);
    expect((await note(n.id)).customFields).toEqual({});
  });

  it("undo of a pre-release record's reference puts the key's previous value back when it held one", async () => {
    const fx = await createBoardFixture(ctx);
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'legacy restore' })).json();
    const now = Timestamp.now();
    const ids = () => ({ apply: crypto.randomUUID(), undo: crypto.randomUUID() });
    const ref = assistantSuggestionsCol(ctx.db, fx.editorId).doc();
    await ref.set({
      boardId: fx.boardId,
      noteId: n.id,
      baseRevision: n.revision,
      fields: {
        dueDate: null,
        priority: null,
        assignee: null,
        title: null,
        reference: { key: 'Customer', value: 'Acme', reason: 'named' },
        subtasks: null,
        links: null,
      },
      typed: [],
      operationIds: {
        dueDate: ids(),
        priority: ids(),
        assignee: ids(),
        title: ids(),
        reference: ids(),
        subtasks: [ids(), ids(), ids(), ids(), ids()],
        links: ids(),
      },
      status: 'PENDING',
      decision: null,
      undone: null,
      applied: null,
      model: 'vertex:gemini-2.5-flash',
      usage: { inputTokens: 1, outputTokens: 1 },
      createdAt: now,
      updatedAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 86_400_000),
    });
    await decide(fx.editToken, fx.boardId, ref.id, { decision: 'keep', source: 'click' });
    expect((await note(n.id)).customFields).toEqual({ Customer: 'Acme' });
    // No route reaches this state (a reference is proposed only on a note with no property);
    // the record is edited to hold a previous value, so the restore branch runs for real.
    await ref.update({ 'applied.before.reference.previous': 'Old GmbH' });
    const undone = await decide(fx.editToken, fx.boardId, ref.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(undone.statusCode).toBe(200);
    expect((await note(n.id)).customFields).toEqual({ Customer: 'Old GmbH' });
  });

  it('keeps a horizon through move_note and the undo moves the note back to Today', async () => {
    const fx = await smartBoard();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'smart' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    expect(suggestion.fields.horizon).toEqual({ value: 'DIESE_WOCHE', reason: '"this week"' });
    const kept = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['horizon'],
      source: 'click',
    });
    expect(kept.statusCode).toBe(200);
    expect((await note(n.id)).horizon).toBe('DIESE_WOCHE');
    const types = await assistantAuditCol(ctx.db).where('approvalId', '==', suggestion.id).get();
    expect(types.docs.map((d) => d.data().commandType)).toEqual(['note.move']);
    await decide(fx.editToken, fx.boardId, suggestion.id, { decision: 'undo', source: 'esc' });
    expect((await note(n.id)).horizon).toBe('HEUTE');
  });

  it("keeps Private on the author's note, and the undo leaves it shared and unassigned", async () => {
    const fx = await smartBoard();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'private dated' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    // Private drops the person beside it: a private note is always its author's.
    expect(suggestion.fields).toMatchObject({
      visibility: { value: 'PRIVATE' },
      assignee: null,
      dueDate: { value: '2026-10-23' },
    });
    const kept = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['dueDate', 'visibility'],
      source: 'click',
    });
    expect(kept.statusCode).toBe(200);
    expect(await note(n.id)).toMatchObject({
      visibility: 'PRIVATE',
      assigneeId: fx.editorId,
      dueDate: '2026-10-23',
    });
    const undone = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(undone.statusCode).toBe(200);
    expect(await note(n.id)).toMatchObject({
      visibility: 'SHARED',
      assigneeId: null,
      dueDate: null,
    });
  });

  it('keeps two of three tags and one of two properties, and the undo removes exactly those', async () => {
    const fx = await smartBoard();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'smart' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const kept = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['tags', 'properties'],
      tags: [2, 0],
      properties: [1],
      source: 'click',
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().suggestion.kept).toMatchObject({ tags: [0, 2], properties: [1] });
    const after = await note(n.id);
    expect(after.tags).toEqual(['ops', 'travel']);
    expect(after.customFields).toEqual({ Project: 'Relaunch' });
    await decide(fx.editToken, fx.boardId, suggestion.id, { decision: 'undo', source: 'esc' });
    const undone = await note(n.id);
    expect(undone.tags).toEqual([]);
    expect(undone.customFields).toEqual({});
  });

  it("keeps a description only with the person's click, and the undo empties it", async () => {
    const fx = await smartBoard();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'smart' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const kept = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['title', 'description'],
      source: 'click',
    });
    expect(kept.statusCode).toBe(200);
    expect(await note(n.id)).toMatchObject({ title: 'Smart note', description: 'The detail.' });
    await decide(fx.editToken, fx.boardId, suggestion.id, { decision: 'undo', source: 'esc' });
    expect(await note(n.id)).toMatchObject({ title: 'smart', description: '' });
  });

  it('the countdown keeps the title, description, horizon and tags, but never Private', async () => {
    const fx = await smartBoard();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'smart' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['title', 'horizon', 'tags', 'properties', 'description'],
      source: 'countdown',
    });
    expect(res.json().suggestion.kept.fields).toEqual([
      'title',
      'horizon',
      'tags',
      'properties',
      'description',
    ]);
    expect(await note(n.id)).toMatchObject({ title: 'Smart note', description: 'The detail.' });
    const p = (await createNote(fx.editToken, fx.boardId, { title: 'private dated' })).json();
    const proposal = (await suggest(fx.editToken, fx.boardId, p.id)).json().suggestion;
    const fired = await decide(fx.editToken, fx.boardId, proposal.id, {
      decision: 'keep',
      fields: ['dueDate', 'visibility'],
      source: 'countdown',
    });
    expect(fired.json().suggestion.kept.fields).toEqual(['dueDate']);
    expect((await note(p.id)).visibility).toBe('SHARED');
  });

  it('a countdown with only opt-in fields ticked writes nothing and the record stays pending', async () => {
    const fx = await smartBoard();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'private' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    expect(suggestion.fields.visibility).toMatchObject({ value: 'PRIVATE' });
    const fired = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'countdown',
    });
    expect(fired.statusCode).toBe(200);
    expect(fired.json().suggestion).toMatchObject({ status: 'PENDING', kept: null });
    expect(await note(n.id)).toMatchObject({ visibility: 'SHARED', revision: n.revision });
  });

  it('a keep of Private refused at the tags puts the note back shared and unassigned', async () => {
    const fx = await smartBoard();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'privtags' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const record = await stored(fx.editorId, suggestion.id);
    // Private committed (assigning the author), then a panel edit landed before the tags.
    await runOperation(asSuggestion(fx.editorId, fx.boardId, suggestion.id), {
      name: 'update_note',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: n.revision,
        input: { visibility: 'PRIVATE' },
      },
      operationId: record.operationIds.visibility!.apply,
    });
    expect(await note(n.id)).toMatchObject({ visibility: 'PRIVATE', assigneeId: fx.editorId });
    await assistantSuggestionsCol(ctx.db, fx.editorId)
      .doc(suggestion.id)
      .update({
        status: 'KEPT',
        decision: {
          source: 'click',
          fields: ['visibility', 'tags'],
          tags: [0],
          at: record.createdAt,
        },
      });
    await patchNote(fx.editToken, n.id, { dueDate: '2026-11-02' });
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'click',
    });
    expect(res.statusCode).toBe(409);
    const after = await note(n.id);
    expect(after).toMatchObject({ visibility: 'SHARED', assigneeId: null, dueDate: '2026-11-02' });
    expect(after.tags).toEqual([]);
    expect((await stored(fx.editorId, suggestion.id)).status).toBe('DISCARDED');
  });

  it('an undo refused after taking Private back makes the note private again, and stays kept', async () => {
    const fx = await smartBoard();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'privwhen' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const kept = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['horizon', 'visibility'],
      source: 'click',
    });
    expect(kept.statusCode).toBe(200);
    const record = await stored(fx.editorId, suggestion.id);
    const at = record.applied!.revision;
    // The undo's first two writes committed (shared again, then unassigned), then a panel
    // edit landed before the horizon went back.
    const asEditor = asSuggestion(fx.editorId, fx.boardId, suggestion.id);
    await runOperation(asEditor, {
      name: 'update_note',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: at,
        input: { visibility: 'SHARED' },
      },
      operationId: record.operationIds.visibility!.undo,
    });
    await runOperation(asEditor, {
      name: 'assign_note',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: at + 1,
        input: { assigneeId: null },
      },
      operationId: record.operationIds.visibility!.undoAssignee,
    });
    await patchNote(fx.editToken, n.id, { dueDate: '2026-11-02' });
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'esc',
    });
    expect(res.statusCode).toBe(409);
    expect(await note(n.id)).toMatchObject({
      visibility: 'PRIVATE',
      assigneeId: fx.editorId,
      horizon: 'DIESE_WOCHE',
      dueDate: '2026-11-02',
    });
    expect((await stored(fx.editorId, suggestion.id)).status).toBe('KEPT');
  });

  it('a keep refused part way through the new steps puts back what it wrote', async () => {
    const fx = await smartBoard();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'smart' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const record = await stored(fx.editorId, suggestion.id);
    // The horizon committed, then a panel edit landed before the tags.
    await runOperation(asSuggestion(fx.editorId, fx.boardId, suggestion.id), {
      name: 'move_note',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: n.revision,
        input: { mode: 'HORIZON', horizon: 'DIESE_WOCHE' },
      },
      operationId: record.operationIds.horizon!.apply,
    });
    await assistantSuggestionsCol(ctx.db, fx.editorId)
      .doc(suggestion.id)
      .update({
        status: 'KEPT',
        decision: { source: 'click', fields: ['horizon', 'tags'], tags: [0], at: record.createdAt },
      });
    await patchNote(fx.editToken, n.id, { dueDate: '2026-11-02' });
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      source: 'click',
    });
    expect(res.statusCode).toBe(409);
    const after = await note(n.id);
    expect(after).toMatchObject({ horizon: 'HEUTE', dueDate: '2026-11-02' });
    expect(after.tags).toEqual([]);
    expect((await stored(fx.editorId, suggestion.id)).status).toBe('DISCARDED');
  });

  // These run as the viewer, on private notes: the owner and the editor already come close to
  // the route's per-user rate limit of 30 captures a minute in this file.

  it('a late countdown keep is refused on an undone or a discarded record', async () => {
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

    // On a discarded one the same: the title is now kept by the countdown, and the record
    // was already decided.
    const other = await own('titleonly two');
    const second = (await suggest(fx.viewToken, fx.boardId, other.id)).json().suggestion;
    await decide(fx.viewToken, fx.boardId, second.id, { decision: 'discard', source: 'esc' });
    const fired = await decide(fx.viewToken, fx.boardId, second.id, {
      decision: 'keep',
      source: 'countdown',
    });
    expect(fired.statusCode).toBe(409);
    expect(fired.json().error).toBe('ASSISTANT_SUGGESTION_SETTLED');
    expect((await note(other.id)).revision).toBe(other.revision);
  });

  it('reads no board keys for a note that has a property already: the prompt lists none', async () => {
    const fx = await createBoardFixture(ctx);
    await createNote(fx.editToken, fx.boardId, { title: 'Old', customFields: { Customer: 'Old' } });
    const n = (
      await createNote(fx.viewToken, fx.boardId, {
        title: 'Friday',
        visibility: 'PRIVATE',
        customFields: { Project: 'X' },
      })
    ).json();
    const s = (await suggest(fx.viewToken, fx.boardId, n.id)).json().suggestion;
    expect(s.fields).toMatchObject({ dueDate: { value: '2026-10-23' }, reference: null });
    // No reference can be proposed, so the board's keys are never read for the prompt.
    expect(lastInput?.prompt).toContain('Properties on this board: none');
    expect(lastInput?.prompt).not.toContain('Customer');
  });

  it('proposes links to the other open notes the model names, once each, with their titles', async () => {
    const fx = await createBoardFixture(ctx);
    const older = (await createNote(fx.editToken, fx.boardId, { title: 'Older' })).json();
    const other = (
      await createNote(fx.editToken, fx.boardId, { title: 'Quote for Müller' })
    ).json();
    const done = (await createNote(fx.editToken, fx.boardId, { title: 'Done one' })).json();
    const completed = await ctx.inject({
      method: 'POST',
      url: `/notes/${done.id}/complete`,
      headers: ctx.authHeader(fx.editToken),
    });
    expect(completed.statusCode).toBe(200);
    const n = (
      await createNote(fx.viewToken, fx.boardId, {
        title: 'related: call Müller',
        visibility: 'PRIVATE',
      })
    ).json();
    const { suggestion } = (await suggest(fx.viewToken, fx.boardId, n.id)).json();
    // The repeated id and the one not on the board drop out; the item reads with its title.
    expect(suggestion.fields.links).toEqual({
      items: [{ index: 0, noteId: other.id, title: 'Quote for Müller', reason: 'same customer' }],
      reason: 'related',
    });
    // The newest note first: the fake names the first row.
    expect(lastInput?.prompt).toContain(
      `Other notes on this board:\n${other.id}: Quote for Müller\n${older.id}: Older`,
    );
    // A done note is not offered, and the note itself is never a row.
    expect(lastInput?.prompt).not.toContain(done.id);
    expect(lastInput?.prompt).not.toContain(n.id + ':');
  });

  it('proposes no links on a note that already has one, and the prompt lists no other notes then', async () => {
    const fx = await createBoardFixture(ctx);
    const other = (await createNote(fx.editToken, fx.boardId, { title: 'Quote' })).json();
    const n = (
      await createNote(fx.viewToken, fx.boardId, {
        title: 'related: linked already',
        visibility: 'PRIVATE',
      })
    ).json();
    const linked = await patchNote(fx.viewToken, n.id, { linkChanges: { add: [other.id] } });
    expect(linked.statusCode).toBe(200);
    const { suggestion } = (await suggest(fx.viewToken, fx.boardId, n.id)).json();
    expect(suggestion?.fields.links ?? null).toBeNull();
    expect(lastInput?.prompt).toContain('Other notes on this board: none');
  });

  // Links. These run as the editor too: the owner's captures in this file already reach the
  // route's per-user rate limit of 30 a minute.
  it('keeps two of three proposed links in one write, replays once, and undo removes exactly them', async () => {
    const fx = await createBoardFixture(ctx);
    const a = (await createNote(fx.editToken, fx.boardId, { title: 'A' })).json();
    const b = (await createNote(fx.editToken, fx.boardId, { title: 'B' })).json();
    const c = (await createNote(fx.editToken, fx.boardId, { title: 'C' })).json();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'threelinks' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    expect(suggestion.fields.links.items.map((i: { noteId: string }) => i.noteId)).toEqual([
      c.id,
      b.id,
      a.id,
    ]);
    const kept = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['links'],
      links: [0, 2],
      source: 'click',
    });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().suggestion.kept).toMatchObject({ fields: ['links'], links: [0, 2] });
    expect((await note(n.id)).links).toEqual([c.id, a.id]);
    expect((await note(n.id)).revision).toBe(n.revision + 1);
    expect(await audits(fx.editorId)).toBe(1);
    await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['links'],
      links: [0, 2],
      source: 'click',
    });
    expect((await note(n.id)).revision).toBe(n.revision + 1);
    expect(await audits(fx.editorId)).toBe(1);
    // What the undo takes back: the ticked items and the ids they named, in index order.
    expect((await stored(fx.editorId, suggestion.id)).applied).toMatchObject({
      links: [0, 2],
      linkIds: [c.id, a.id],
    });
    const undone = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'click',
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().suggestion.status).toBe('UNDONE');
    expect((await note(n.id)).links).toEqual([]);
    expect((await note(n.id)).revision).toBe(n.revision + 2);
    expect(await audits(fx.editorId)).toBe(2);
  });

  it('a link added by hand after the keep moves the revision, so the undo is refused and every link stays', async () => {
    const fx = await createBoardFixture(ctx);
    const a = (await createNote(fx.editToken, fx.boardId, { title: 'A' })).json();
    const b = (await createNote(fx.editToken, fx.boardId, { title: 'B' })).json();
    const c = (await createNote(fx.editToken, fx.boardId, { title: 'C' })).json();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'threelinks' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'keep',
      fields: ['links'],
      links: [0, 2],
      source: 'click',
    });
    // The undo runs on the kept revision (WALLYBOT_INLINE.md §4), as for every other field, so
    // the hand edit refuses it before anything is written: the hand link stays, and so do the
    // kept ones.
    const linked = await patchNote(fx.editToken, n.id, { linkChanges: { add: [b.id] } });
    expect(linked.statusCode).toBe(200);
    expect(await audits(fx.editorId)).toBe(1);
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'click',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    expect(await note(n.id)).toMatchObject({
      links: [c.id, a.id, b.id],
      revision: n.revision + 2,
    });
    expect(await audits(fx.editorId)).toBe(1);
    expect((await stored(fx.editorId, suggestion.id)).status).toBe('KEPT');
  });

  it('an undo refused after removing the links puts them back, and the record stays kept', async () => {
    const fx = await createBoardFixture(ctx);
    const a = (await createNote(fx.editToken, fx.boardId, { title: 'A' })).json();
    const b = (await createNote(fx.editToken, fx.boardId, { title: 'B' })).json();
    const n = (await createNote(fx.editToken, fx.boardId, { title: 'threelinks dated' })).json();
    const { suggestion } = (await suggest(fx.editToken, fx.boardId, n.id)).json();
    const kept = (
      await decide(fx.editToken, fx.boardId, suggestion.id, {
        decision: 'keep',
        fields: ['dueDate', 'links'],
        source: 'click',
      })
    ).json().suggestion.kept;
    expect(kept).toMatchObject({ fields: ['dueDate', 'links'], links: [0, 1] });
    expect(await note(n.id)).toMatchObject({ dueDate: '2026-10-23', links: [b.id, a.id] });
    const record = await stored(fx.editorId, suggestion.id);
    // The undo's first inverse write (the links) commits, then a panel edit lands before its
    // second (the date).
    await runOperation(asSuggestion(fx.editorId, fx.boardId, suggestion.id), {
      name: 'update_note',
      input: {
        boardId: fx.boardId,
        noteId: n.id,
        expectedRevision: kept.revision,
        input: { linkChanges: { remove: [b.id, a.id] } },
      },
      operationId: record.operationIds.links!.undo,
    });
    expect((await note(n.id)).links).toEqual([]);
    expect((await patchTitle(fx.editToken, n.id, 'Afterwards')).statusCode).toBe(200);
    const res = await decide(fx.editToken, fx.boardId, suggestion.id, {
      decision: 'undo',
      source: 'click',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('STALE_REVISION');
    // Not half undone: the links are back beside the date and the person's edit.
    expect(await note(n.id)).toMatchObject({
      title: 'Afterwards',
      dueDate: '2026-10-23',
      links: [b.id, a.id],
    });
    expect((await stored(fx.editorId, suggestion.id)).status).toBe('KEPT');
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
