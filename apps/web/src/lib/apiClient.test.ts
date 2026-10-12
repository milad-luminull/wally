import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api } from './apiClient';
import { getFreshIdToken } from '@/features/auth/AuthProvider';
import {
  captureMutation,
  getRecoveries,
  rememberResource,
  resetMutationSession,
  retryMutation,
} from './mutationQueue';
vi.mock('@/features/auth/AuthProvider', () => ({ getFreshIdToken: vi.fn() }));
const response = (data: unknown, revision = 1) =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'X-Resource-Revision': String(revision) },
  });
beforeEach(() => {
  resetMutationSession();
  vi.mocked(getFreshIdToken).mockResolvedValue('token');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('reuses headers and payload through authentication refresh and a lost-response retry', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    .mockRejectedValueOnce(new TypeError('lost response'))
    .mockResolvedValueOnce(response({ id: 'one' }, 2));
  vi.stubGlobal('fetch', fetcher);
  const ticket = captureMutation('note:a', { revision: 1 });
  await expect(api.patch('/notes/a', { title: 'Draft' }, undefined, ticket)).rejects.toThrow(
    'lost',
  );
  await retryMutation(ticket.operationId);
  expect(fetcher).toHaveBeenCalledTimes(3);
  const requests = fetcher.mock.calls.map((call) => call[1]);
  for (const request of requests) {
    expect(request.headers['Idempotency-Key']).toBe(ticket.operationId);
    expect(request.headers['X-Expected-Revision']).toBe('1');
    expect(request.body).toBe(JSON.stringify({ title: 'Draft' }));
  }
  expect(getFreshIdToken).toHaveBeenCalledWith(true);
});

it('loads the reviewed snapshot revision without borrowing a newer background revision', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'STALE_REVISION' }), { status: 409 }),
    )
    .mockResolvedValueOnce(response([{ id: 'member', role: 'VIEW' }], 4));
  vi.stubGlobal('fetch', fetcher);
  await api
    .patch(
      '/whiteboards/b/members/member',
      { role: 'EDIT' },
      undefined,
      captureMutation('board:b', { revision: 1 }),
    )
    .catch(() => {});
  rememberResource('board:b', 9);
  const reviewed = await getRecoveries()[0]!.description!.loadLatest();
  expect(reviewed.revision).toBe(4);
  expect(reviewed.data).toMatchObject({ role: 'VIEW' });
});

it('rejects a late read response after account switching and aborts its request', async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const pending = api.get('/notes/a', z.object({ title: z.string() }));
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
  resetMutationSession();
  resolve(response({ title: 'Old account secret' }));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(signal.aborted).toBe(true);
});

it('resolves the proposed assignee and target subtask for review', async () => {
  const stale = () => new Response(JSON.stringify({ error: 'STALE_REVISION' }), { status: 409 });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(stale())
    .mockResolvedValueOnce(
      response({ title: 'Target note', whiteboardId: 'b', assignee: null, revision: 3 }, 3),
    )
    .mockResolvedValueOnce(
      response([{ userId: 'sam', displayName: 'Sam Example', email: 'sam@example.test' }], 8),
    );
  vi.stubGlobal('fetch', fetcher);
  await api
    .post(
      '/notes/a/assign',
      { assigneeId: 'sam' },
      undefined,
      captureMutation('note:a', { revision: 1 }),
    )
    .catch(() => {});
  expect(await getRecoveries()[0]!.description!.loadLatest()).toMatchObject({
    revision: 3,
    data: { title: 'Target note' },
    proposed: { assignee: 'Sam Example' },
  });
  resetMutationSession();
  fetcher.mockResolvedValueOnce(stale()).mockResolvedValueOnce(
    response(
      {
        title: 'Target note',
        revision: 4,
        subtasks: [{ id: 'task', text: 'Target task', done: false }],
      },
      4,
    ),
  );
  await api
    .patch(
      '/notes/a/subtasks/task',
      { done: true },
      undefined,
      captureMutation('note:a', { revision: 1 }),
    )
    .catch(() => {});
  expect(await getRecoveries()[0]!.description!.loadLatest()).toMatchObject({
    revision: 4,
    data: { text: 'Target task', done: false },
    proposed: { text: 'Target task', done: true },
  });
});
