import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AI_REQUEST_TIMEOUT_MS,
  api,
  REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  TURN_REQUEST_TIMEOUT_MS,
} from './apiClient';
import { getFreshIdToken } from '@/features/auth/AuthProvider';
import { failureOf } from './errors';
import {
  captureMutation,
  getRecoveries,
  isMutationPending,
  rememberResource,
  resetMutationSession,
  retryMutation,
} from './mutationQueue';
import { boardsApi } from './resources';
vi.mock('@/features/auth/AuthProvider', () => ({
  getFreshIdToken: vi.fn(),
  expireSession: vi.fn(),
}));
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

const failure = (status: number, error: string) =>
  new Response(JSON.stringify({ error, message: error }), { status });
const headersOf = (fetcher: ReturnType<typeof vi.fn>, call = -1) =>
  fetcher.mock.calls.at(call)![1].headers as Record<string, string>;

// RFC-0002 §8: the create dialog shows its own errors. A failed create must not leave an
// "unsaved change" behind, and it never carries a revision.
it('creates a board with an operation id, no expected revision and no recovery on failure', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(failure(422, 'BOARD_LIMIT_REACHED'));
  vi.stubGlobal('fetch', fetcher);
  await expect(boardsApi.create('Zu viel')).rejects.toMatchObject({
    code: 'BOARD_LIMIT_REACHED',
  });
  expect(headersOf(fetcher)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(headersOf(fetcher)['X-Expected-Revision']).toBeUndefined();
  expect(getRecoveries()).toEqual([]);
});

it('sends no expected revision when leaving, even when the board revision is known', async () => {
  rememberResource('board:b', 3);
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  await boardsApi.leave('b');
  expect(headersOf(fetcher)['Idempotency-Key']).toBeDefined();
  expect(headersOf(fetcher)['X-Expected-Revision']).toBeUndefined();
});

it('sends the board revision when deleting a board', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  await boardsApi.remove('b', captureMutation('board:b', { revision: 3 }));
  expect(fetcher.mock.calls[0]![0]).toContain('/whiteboards/b');
  expect(fetcher.mock.calls[0]![1].method).toBe('DELETE');
  expect(headersOf(fetcher)['X-Expected-Revision']).toBe('3');
});

it('treats 404 on delete or leave as already gone and leaves no recovery', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(failure(404, 'NOT_FOUND'))
    .mockResolvedValueOnce(failure(404, 'NOT_FOUND'));
  vi.stubGlobal('fetch', fetcher);
  await expect(
    boardsApi.remove('b', captureMutation('board:b', { revision: 3 })),
  ).resolves.toBeUndefined();
  await expect(boardsApi.leave('c')).resolves.toBeUndefined();
  expect(getRecoveries()).toEqual([]);
  expect(isMutationPending('board:b')).toBe(false);
});

it('clears the recovery when a retried delete finds the board already gone', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('lost response'))
    .mockResolvedValueOnce(failure(404, 'NOT_FOUND'))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  const ticket = captureMutation('board:b', { revision: 3 });
  await expect(boardsApi.remove('b', ticket)).rejects.toThrow('lost');
  const [recovery] = getRecoveries();
  expect(recovery?.description?.action).toBe('deleteBoard');
  await retryMutation(ticket.operationId);
  expect(getRecoveries()).toEqual([]);
  // The lane is free again: a later board write goes out.
  await api.patch('/whiteboards/b', { name: 'x' }, undefined, captureMutation('board:b'));
  expect(fetcher).toHaveBeenCalledTimes(3);
});

// A delete refused as stale opens the review dialog. Without a proposal it showed an empty
// "your change" column; it should say which board and what would happen to it.
it('reviews a stale board deletion with the board name and the change spelled out', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(failure(409, 'STALE_REVISION'))
    .mockResolvedValueOnce(
      response({ id: 'b', name: 'Project North', ownerId: 'u', revision: 4 }, 4),
    );
  vi.stubGlobal('fetch', fetcher);
  await boardsApi.remove('b', captureMutation('board:b', { revision: 3 })).catch(() => {});

  const reviewed = await getRecoveries()[0]!.description!.loadLatest();

  expect(reviewed.revision).toBe(4);
  expect(reviewed.proposed).toEqual({ name: 'Project North', change: 'Delete board' });
});

it('gives up on a request that hangs, as a timeout the person can retry', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
          ),
      ),
    );
    const pending = api.get('/me', z.unknown());
    const settled = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await settled;
  } finally {
    vi.useRealTimers();
  }
});

it('never signs anyone out when a fresh token is still refused: it is a failure to retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })),
  );
  const error = await api.get('/me', z.unknown()).catch((e: unknown) => e);
  expect(error).toMatchObject({ status: 401 });
  expect(failureOf(error)?.kind).toBe('temporary');
  expect(getFreshIdToken).toHaveBeenCalledWith(true);
});

it('waits longer for a question to the wall than the server allows it', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
          ),
      ),
    );
    expect(TURN_REQUEST_TIMEOUT_MS).toBeGreaterThan(60_000);
    let settled = false;
    const pending = api.post('/whiteboards/b1/assistant/turns', {}, z.unknown()).catch((e) => {
      settled = true;
      return e;
    });
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS + 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(TURN_REQUEST_TIMEOUT_MS);
    expect(await pending).toBeInstanceOf(RequestTimeoutError);
  } finally {
    vi.useRealTimers();
  }
});

it('waits longer for a capture or a tidy than the server allows it, with room to spare', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
          ),
      ),
    );
    // The server's capture and tidy deadline is 40 s; the answer still has to travel back.
    for (const path of ['/whiteboards/b1/assistant/captures', '/whiteboards/b1/assistant/tidies']) {
      let settled = false;
      const pending = api.post(path, {}, z.unknown()).catch((e) => {
        settled = true;
        return e;
      });
      await vi.advanceTimersByTimeAsync(50_000);
      expect(settled, path).toBe(false);
      await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS);
      expect(await pending).toBeInstanceOf(RequestTimeoutError);
    }
  } finally {
    vi.useRealTimers();
  }
});
