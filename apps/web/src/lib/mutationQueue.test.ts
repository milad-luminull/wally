import { beforeEach, describe, expect, it } from 'vitest';
import {
  captureMutation,
  enqueueMutation,
  rememberResource,
  resetMutationSession,
  retryMutation,
  getRecoveries,
  whenSettled,
} from './mutationQueue';

beforeEach(() => resetMutationSession());
describe('mutation serialization and recovery', () => {
  it('serializes local edits using only locally acknowledged revision transitions', async () => {
    rememberResource('note:a', 2);
    const first = captureMutation('note:a');
    const second = captureMutation('note:a');
    let resolve!: () => void;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    const seen: number[] = [];
    const a = enqueueMutation(first, async (meta) => {
      seen.push(meta.expectedRevision!);
      await gate;
      return { data: 'a', revision: 3 };
    });
    const b = enqueueMutation(second, async (meta) => {
      seen.push(meta.expectedRevision!);
      return { data: 'b', revision: 4 };
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([2]);
    resolve();
    await Promise.all([a, b]);
    expect(seen).toEqual([2, 3]);
  });

  it('does not silently rebase a captured draft on a remotely fetched revision', async () => {
    rememberResource('note:a', 2);
    const draft = captureMutation('note:a');
    rememberResource('note:a', 7);
    let sent: number | undefined;
    await enqueueMutation(draft, async (meta) => {
      sent = meta.expectedRevision;
      return { data: null, revision: 3 };
    });
    expect(sent).toBe(2);
  });

  it('preserves delayed deletion revision even after a local edit', async () => {
    rememberResource('note:a', 2);
    const deletion = captureMutation('note:a', { pinned: true });
    await enqueueMutation(captureMutation('note:a'), async () => ({ data: null, revision: 3 }));
    await enqueueMutation(deletion, async (meta) => {
      expect(meta.expectedRevision).toBe(2);
      return { data: null, revision: 3 };
    });
  });

  it('blocks following work on conflict and requires an explicitly reviewed revision', async () => {
    rememberResource('note:a', 1);
    let calls = 0;
    const ticket = captureMutation('note:a');
    await expect(
      enqueueMutation(ticket, async (meta) => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('stale'), { code: 'STALE_REVISION' });
        expect(meta.expectedRevision).toBe(4);
        expect(meta.operationId).not.toBe(ticket.operationId);
        return { data: 'saved', revision: 5 };
      }),
    ).rejects.toThrow('stale');
    const blocked = captureMutation('note:a');
    await expect(
      enqueueMutation(blocked, async () => {
        calls++;
        return { data: '', revision: 2 };
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    expect(getRecoveries()).toHaveLength(2);
    await retryMutation(ticket.operationId, 4);
    expect(calls).toBe(2);
  });

  it('retries an uncertain response with the original operation ID', async () => {
    rememberResource('note:a', 1);
    const ticket = captureMutation('note:a');
    let attempt = 0;
    await expect(
      enqueueMutation(ticket, async (meta) => {
        expect(meta.operationId).toBe(ticket.operationId);
        if (attempt++ === 0) throw new TypeError('network lost');
        return { data: 'saved', revision: 2 };
      }),
    ).rejects.toThrow();
    await retryMutation(ticket.operationId);
    expect(attempt).toBe(2);
  });

  it('cancels work captured before account switching', async () => {
    const ticket = captureMutation('note:a');
    resetMutationSession();
    let sent = false;
    await expect(
      enqueueMutation(ticket, async () => {
        sent = true;
        return { data: '', revision: 1 };
      }),
    ).rejects.toThrow();
    expect(sent).toBe(false);
  });

  it('does not replay an uncertain creation after receipt retention expires', async () => {
    const ticket = captureMutation('create:a');
    let calls = 0;
    await enqueueMutation(ticket, async () => {
      calls++;
      throw new TypeError('network lost');
    }).catch(() => {});
    ticket.createdAt = Date.now() - 8 * 86400000;
    await expect(retryMutation(ticket.operationId)).rejects.toThrow(/expired/i);
    expect(calls).toBe(1);
  });
});

it('preserves an uncertain request when blur resubmits its ticket to a blocked lane', async () => {
  const ticket = captureMutation('note:blur', { revision: 1 });
  let attempts = 0;
  const send = async (metadata: { operationId: string; expectedRevision?: number }) => {
    expect(metadata).toEqual({ operationId: ticket.operationId, expectedRevision: 1 });
    if (attempts++ === 0) throw new TypeError('lost response');
    return { data: 'Original draft', revision: 2 };
  };
  await enqueueMutation(ticket, send, {
    action: 'update',
    input: { title: 'Original draft' },
    loadLatest: async () => ({ data: null, revision: 2 }),
  }).catch(() => {});
  await enqueueMutation(ticket, async () => ({ data: 'Changed body', revision: 2 })).catch(
    () => {},
  );
  expect(getRecoveries()[0]!.conflict).toBe(false);
  expect(getRecoveries()[0]!.description?.input).toEqual({ title: 'Original draft' });
  await retryMutation(ticket.operationId);
  expect(attempts).toBe(2);
});

describe('whenSettled', () => {
  it('resolves at once for an idle lane, and after every queued write of a busy one', async () => {
    await expect(whenSettled('note:idle')).resolves.toBeUndefined();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const order: string[] = [];
    void enqueueMutation(captureMutation('note:b'), async () => {
      await gate;
      order.push('first');
      return { data: null, revision: 2 };
    });
    void enqueueMutation(captureMutation('note:b'), async () => {
      order.push('second');
      return { data: null, revision: 3 };
    });
    const settled = whenSettled('note:b').then(() => order.push('settled'));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await settled;
    expect(order).toEqual(['first', 'second', 'settled']);
  });

  it('resolves after a failed write too', async () => {
    void enqueueMutation(captureMutation('note:c'), async () => {
      throw new Error('offline');
    }).catch(() => {});
    await expect(whenSettled('note:c')).resolves.toBeUndefined();
  });
});
