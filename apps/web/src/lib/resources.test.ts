import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notesApi, shareLinkApi } from './resources';
import { makeNote } from '@/test/fixtures';

vi.mock('@/features/auth/AuthProvider', () => ({
  getFreshIdToken: () => Promise.resolve('test-token'),
}));

/**
 * The note WRITE routes answer with the list-shaped note, not the detail one:
 * apps/api/src/routes/notes.ts returns `toNoteDto` from create/update/move/assign/
 * complete/reopen and `toNoteDetailDto` only from `GET /notes/:id`.
 *
 * The client used to declare all of them as `noteDetailDtoSchema`, so each call failed
 * response validation on an otherwise successful 200 ("subtasks: Required, history:
 * Required"). Every optimistic update was therefore rolled back by `onError` and then
 * re-applied by the settling refetch — visible on the board as a dragged note snapping
 * back to the zone it came from right after a successful drop.
 */
describe('notesApi write-route response contract', () => {
  const originalFetch = globalThis.fetch;

  function respondWith(body: unknown) {
    const spy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    return spy;
  }

  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.test');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  /** Exactly what the API sends back: no `subtasks`, no `history`. */
  const listShaped = makeNote({ horizon: 'SPAETER' });

  it('accepts a list-shaped body from move', async () => {
    respondWith(listShaped);
    await expect(notesApi.move('note-1', { mode: 'HORIZON', horizon: 'SPAETER' })).resolves.toMatchObject({
      id: 'note-1',
      horizon: 'SPAETER',
    });
  });

  it('accepts a list-shaped body from the other write routes', async () => {
    respondWith(listShaped);
    await expect(notesApi.update('note-1', { title: 'x' })).resolves.toMatchObject({ id: 'note-1' });

    respondWith(listShaped);
    await expect(notesApi.assign('note-1', null)).resolves.toMatchObject({ id: 'note-1' });

    respondWith(listShaped);
    await expect(notesApi.complete('note-1')).resolves.toMatchObject({ id: 'note-1' });

    respondWith(listShaped);
    await expect(notesApi.reopen('note-1')).resolves.toMatchObject({ id: 'note-1' });

    respondWith(listShaped);
    await expect(notesApi.create('board-1', {})).resolves.toMatchObject({ id: 'note-1' });
  });

  it('still accepts a fuller detail-shaped body, so the routes may grow later', async () => {
    respondWith({ ...listShaped, subtasks: [], history: [] });
    await expect(notesApi.move('note-1', { mode: 'PRIORITY', priority: 'HOCH' })).resolves.toMatchObject({
      id: 'note-1',
    });
  });
});

/**
 * The API mints share URLs as `${CORS_ORIGIN}/share/${token}` and exposes
 * `POST /share-links/:token/redeem`, but the client had no redeem call and the app had no
 * route, so every share link anyone sent fell through to the 404 page.
 */
describe('shareLinkApi.redeem', () => {
  const originalFetch = globalThis.fetch;

  function respondWith(body: unknown) {
    const spy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    globalThis.fetch = spy as unknown as typeof fetch;
    return spy;
  }

  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.test');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('posts to the redeem route and returns the unlocked board', async () => {
    const spy = respondWith({ whiteboardId: 'board-1', role: 'EDIT' });

    await expect(shareLinkApi.redeem('tok-1')).resolves.toEqual({
      whiteboardId: 'board-1',
      role: 'EDIT',
    });

    // Asserted on the path, not the origin: apiClient reads VITE_API_BASE_URL once at
    // module load, so stubbing the env here would come too late to change it.
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/share-links/tok-1/redeem');
    expect(init.method).toBe('POST');
  });

  it('rejects a response that does not match the shared redeem schema', async () => {
    respondWith({ whiteboardId: 'board-1' });

    // The shared-Zod seam is what makes a backend shape drift fail loudly here rather than
    // flowing into the redirect as undefined.
    await expect(shareLinkApi.redeem('tok-1')).rejects.toThrow(/schema validation/);
  });
});
