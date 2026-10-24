import { expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { buildTestApp, createBoardFixture, resetDatabase } from './helpers.js';
import { processAccountDeletion } from '../src/lib/account/cleanup.js';
import { modelSuggestionSchema } from '../src/lib/assistant/model/suggest.js';

it.each(['capture', 'tidy'] as const)(
  'does not persist a delayed %s after another member deletes the board',
  async (kind) => {
    const project = `wally-account-assistant-cleanup-${kind}`;
    let resume!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let noteId = '';
    const pause = async () => {
      entered();
      await waiting;
    };
    const ctx = await buildTestApp(project, {
      assistantEnabled: true,
      suggestionRunner: async () => {
        await pause();
        return {
          fields: modelSuggestionSchema.parse({
            priority: null,
            assignee: null,
            dueDate: { value: '2026-10-30', confidence: 0.9, reason: 'Friday' },
          }),
          usage: null,
          finishReason: 'stop',
        };
      },
      tidyRunner: async () => {
        await pause();
        return {
          moves: { moves: [{ noteId, horizon: 'SPAETER', confidence: 0.9, reason: 'next month' }] },
          usage: null,
          finishReason: 'stop',
        };
      },
    });
    try {
      await resetDatabase(project);
      const fx = await createBoardFixture(ctx);
      Object.assign(ctx.tokens.get(fx.ownerToken)!, {
        authenticatedAt: Math.floor(Date.now() / 1000),
      });
      const note = await ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/notes`,
        headers: ctx.authHeader(fx.editToken),
        payload: { title: 'Plan this for Friday', horizon: 'HEUTE' },
      });
      expect(note.statusCode).toBe(201);
      noteId = note.json().id;
      const request = ctx.inject({
        method: 'POST',
        url: `/whiteboards/${fx.boardId}/assistant/${kind === 'capture' ? 'captures' : 'tidies'}`,
        headers: ctx.authHeader(fx.editToken),
        payload: {
          today: '2026-10-23',
          timeZone: 'Europe/Berlin',
          ...(kind === 'capture' ? { noteId, locked: [] } : {}),
        },
      });
      await Promise.race([
        started,
        request.then((response) => {
          throw new Error(`Request returned before model call: ${response.statusCode}`);
        }),
      ]);
      expect(
        (
          await ctx.inject({
            method: 'DELETE',
            url: '/me',
            headers: ctx.authHeader(fx.ownerToken),
            payload: { confirmation: 'DELETE' },
          })
        ).statusCode,
      ).toBe(202);
      await ctx.db
        .collection('accountDeletionJobs')
        .doc(fx.ownerId)
        .update({ createdAt: Timestamp.fromMillis(Date.now() - 120_001) });
      expect(
        await processAccountDeletion(ctx.db, fx.ownerId, {
          deleteFirebase: async () => {},
          deleteAuth0: async () => {},
        }),
      ).toBe('complete');
      resume();
      expect((await request).statusCode).toBe(404);
      const collection = kind === 'capture' ? 'assistantSuggestions' : 'assistantTidies';
      expect(
        (await ctx.db.collection('users').doc(fx.editorId).collection(collection).get()).empty,
      ).toBe(true);
    } finally {
      resume();
      await ctx.app.close();
      await resetDatabase(project);
    }
  },
);
