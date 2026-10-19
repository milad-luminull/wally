import type { OperationMetadata } from '@wally/shared';

export interface MutationTicket {
  operationId: string;
  resource: string;
  revision?: number;
  generation: number;
  createdAt: number;
  onDiscarded?: () => void;
  pinned?: boolean;
  advance?: boolean;
  onAcknowledged?: () => void;
}
interface Lane {
  pending: number;
  tail: Promise<unknown>;
  transitions: Map<number, number>;
  blocked: boolean;
}
export interface Recovery {
  ticket: MutationTicket;
  error: unknown;
  conflict: boolean;
  send: (metadata: OperationMetadata) => Promise<{ data: unknown; revision: number }>;
  description?: {
    action: string;
    input: unknown;
    loadLatest: () => Promise<{ data: unknown; revision: number; proposed?: unknown }>;
  };
}
let generation = 0;
let controller = new AbortController();
const versions = new Map<string, number>();
const lanes = new Map<string, Lane>();
let recoveries: Recovery[] = [];
const listeners = new Set<() => void>();
export const subscribeRecoveries = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getRecoveries = () => recoveries;
const emit = () => {
  for (const listener of listeners) listener();
};
export const isMutationPending = (resource: string) => (lanes.get(resource)?.pending ?? 0) > 0;
/**
 * Resolves once every write queued on `resource` so far, and every write queued behind them
 * meanwhile, has settled (failed ones included): what the server holds is then the last write.
 */
export async function whenSettled(resource: string): Promise<void> {
  for (;;) {
    const lane = lanes.get(resource);
    if (!lane || lane.pending === 0) return;
    await lane.tail;
    // The lane's own `finally` counts the write out a moment after its tail settles.
    await Promise.resolve();
  }
}
export const sessionGeneration = () => generation;
export const sessionSignal = () => controller.signal;
export const isCurrentSession = (value: number) => value === generation;
export function assertCurrentSession(value: number) {
  if (!isCurrentSession(value)) throw new DOMException('Account changed', 'AbortError');
}
export function resetMutationSession() {
  generation++;
  controller.abort();
  controller = new AbortController();
  versions.clear();
  lanes.clear();
  recoveries = [];
  emit();
}
export function rememberResource(resource: string, revision: number) {
  // An older read completing after a write cannot move the observed version backwards.
  versions.set(resource, Math.max(versions.get(resource) ?? 0, revision));
}
export function captureMutation(
  resource: string,
  options: { revision?: number; pinned?: boolean; advance?: boolean } = {},
): MutationTicket {
  return {
    operationId: crypto.randomUUID(),
    createdAt: Date.now(),
    resource,
    revision: options.revision ?? versions.get(resource),
    generation,
    pinned: options.pinned,
    advance: options.advance,
  };
}
export function discardRecovery(id: string) {
  const found = recoveries.find((r) => r.ticket.operationId === id);
  found?.ticket.onDiscarded?.();
  recoveries = recoveries.filter((r) => r.ticket.operationId !== id);
  if (found && !recoveries.some((r) => r.ticket.resource === found.ticket.resource)) {
    const lane = lanes.get(found.ticket.resource);
    if (lane) lane.blocked = false;
  }
  emit();
}
export async function enqueueMutation<T>(
  ticket: MutationTicket,
  send: (metadata: OperationMetadata) => Promise<{ data: T; revision: number }>,
  description?: Recovery['description'],
): Promise<T> {
  assertCurrentSession(ticket.generation);
  // Blur/unmount can resubmit an autosave ticket. An uncertain request is immutable:
  // never replace its body or turn it into a reviewed action just because its lane stopped.
  const existing = recoveries.find((item) => item.ticket.operationId === ticket.operationId);
  if (existing) throw existing.error;
  let lane = lanes.get(ticket.resource);
  if (!lane) {
    lane = { pending: 0, tail: Promise.resolve(), transitions: new Map(), blocked: false };
    lanes.set(ticket.resource, lane);
  }
  const selected = lane;
  selected.pending++;
  const run = selected.tail
    .catch(() => {})
    .then(async () => {
      assertCurrentSession(ticket.generation);
      const prior = recoveries.find((item) => item.ticket.operationId === ticket.operationId);
      if (prior) throw prior.error;
      let expectedRevision = ticket.revision;
      if (!ticket.pinned && expectedRevision !== undefined) {
        const visited = new Set<number>();
        while (selected.transitions.has(expectedRevision) && !visited.has(expectedRevision)) {
          visited.add(expectedRevision);
          expectedRevision = selected.transitions.get(expectedRevision)!;
        }
      }
      // Pin the revision actually sent so an uncertain outcome retries the identical request.
      ticket.revision = expectedRevision;
      try {
        if (selected.blocked)
          throw Object.assign(new Error('Review the previous unsaved change'), {
            code: 'MUTATION_BLOCKED',
          });
        const result = await send({
          operationId: ticket.operationId,
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
        });
        assertCurrentSession(ticket.generation);
        if (ticket.advance !== false) {
          rememberResource(ticket.resource, result.revision);
          if (expectedRevision !== undefined && result.revision > expectedRevision)
            selected.transitions.set(expectedRevision, result.revision);
        }
        ticket.onAcknowledged?.();
        return result.data;
      } catch (error) {
        assertCurrentSession(ticket.generation);
        const code = (error as { code?: string })?.code;
        selected.blocked = true;
        recoveries = [
          ...recoveries.filter((r) => r.ticket.operationId !== ticket.operationId),
          {
            ticket,
            error,
            conflict: code === 'STALE_REVISION' || code === 'MUTATION_BLOCKED',
            send,
            description,
          },
        ];
        emit();
        throw error;
      }
    });
  selected.tail = run.catch(() => {});
  return run.finally(() => {
    selected.pending--;
  });
}
export async function retryMutation(id: string, reviewedRevision?: number): Promise<unknown> {
  const recovery = recoveries.find((r) => r.ticket.operationId === id);
  if (!recovery) return;
  assertCurrentSession(recovery.ticket.generation);
  if (!recovery.conflict && Date.now() - recovery.ticket.createdAt >= 7 * 86400000)
    throw Object.assign(new Error('The supported retry window has expired'), {
      code: 'RETRY_WINDOW_EXPIRED',
    });
  if (recovery.conflict && reviewedRevision === undefined)
    throw new Error('Review the latest version first');
  const lane = lanes.get(recovery.ticket.resource)!;
  // Reviewed conflicts are new actions. Network retries keep the exact original request.
  const ticket = recovery.conflict
    ? {
        ...captureMutation(recovery.ticket.resource, { revision: reviewedRevision, pinned: true }),
        advance: recovery.ticket.advance,
        onAcknowledged: recovery.ticket.onAcknowledged,
        onDiscarded: recovery.ticket.onDiscarded,
      }
    : { ...recovery.ticket, pinned: true };
  recoveries = recoveries.filter((r) => r !== recovery);
  lane.blocked = false;
  emit();
  try {
    return await enqueueMutation(ticket, recovery.send, recovery.description);
  } finally {
    if (recoveries.some((r) => r.ticket.resource === ticket.resource)) lane.blocked = true;
  }
}
