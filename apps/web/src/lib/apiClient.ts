import type { z } from 'zod';
import type { OperationMetadata } from '@wally/shared';
import {
  assertCurrentSession,
  captureMutation,
  enqueueMutation,
  rememberResource,
  sessionGeneration,
  sessionSignal,
  type MutationTicket,
} from './mutationQueue';
import { i18n } from '@/i18n';
import { getFreshIdToken } from '@/features/auth/AuthProvider';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export type ApiErrorKind =
  'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'other';

/** Typed error the TanStack Query hooks can branch on (e.g. redirect to /login on 401). */
export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly body: unknown;
  readonly code: string | undefined;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.code =
      body && typeof body === 'object' && 'error' in body ? String(body.error) : undefined;
    this.kind = classify(status);
  }
}

function classify(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'validation';
  return 'other';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  ticket?: MutationTicket;
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.replace(/^\//, ''), `${BASE_URL}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Thin fetch wrapper: attaches a fresh (or refreshed-on-401) Firebase ID token, and
 * throws a typed ApiError so callers/hooks can branch on `.status`/`.kind` rather than
 * parsing strings.
 */
export function resourceForPath(path: string): string | undefined {
  const parts = path.split('/');
  if (parts[1] === 'notes' && parts[2]) return `note:${parts[2]}`;
  if (parts[1] === 'whiteboards' && parts[2]) return `board:${parts[2]}`;
  return undefined;
}
function observeResponse(path: string, data: unknown, revision: number | undefined) {
  if (revision !== undefined && path.startsWith('/whiteboards/') && !path.endsWith('/notes')) {
    for (const item of Array.isArray(data) ? data : [data])
      if (item && typeof item === 'object') Object.assign(item, { boardRevision: revision });
  }
  if (Array.isArray(data)) {
    for (const item of data)
      if (item?.whiteboardId && item?.id && typeof item.revision === 'number')
        rememberResource(`note:${item.id}`, item.revision);
  } else if (data && typeof data === 'object') {
    const item = data as {
      id?: string;
      whiteboardId?: string;
      revision?: number;
      ownerId?: string;
    };
    if (item.id && typeof item.revision === 'number')
      rememberResource(`${item.ownerId ? 'board' : 'note'}:${item.id}`, item.revision);
  }
  const resource = resourceForPath(path);
  if (
    resource &&
    revision !== undefined &&
    !path.endsWith('/duplicate') &&
    !/^\/whiteboards\/[^/]+\/notes$/.test(path)
  )
    rememberResource(resource, revision);
}
async function request<T>(
  path: string,
  options: RequestOptions = {},
  schema?: z.ZodType<T>,
): Promise<T> {
  const generation = options.ticket?.generation ?? sessionGeneration();
  const signal = sessionSignal();
  const encodedBody = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const method = options.method ?? 'GET';
  const resource = resourceForPath(path);
  const isBoardMutation =
    method !== 'GET' &&
    (resource !== undefined || path.startsWith('/share-links/') || path === '/whiteboards');
  const createsNote = method === 'POST' && /^\/whiteboards\/[^/]+\/notes$/.test(path);
  const redeemsLink = path.startsWith('/share-links/');
  // Account-level board operations (RFC BOARD_HOME §12.1). Create and leave never carry a
  // revision; delete carries the board's.
  const createsBoard = method === 'POST' && path === '/whiteboards';
  const deletesBoard = method === 'DELETE' && /^\/whiteboards\/[^/]+$/.test(path);
  const leavesBoard = method === 'POST' && /^\/whiteboards\/[^/]+\/leave$/.test(path);

  const perform = async (metadata?: OperationMetadata): Promise<{ data: T; revision: number }> => {
    const doFetch = async (forceRefresh: boolean) => {
      assertCurrentSession(generation);
      const token = await getFreshIdToken(forceRefresh);
      assertCurrentSession(generation);
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Accept-Language': i18n.language,
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (encodedBody !== undefined) headers['Content-Type'] = 'application/json';
      if (metadata) {
        headers['Idempotency-Key'] = metadata.operationId;
        if (
          metadata.expectedRevision !== undefined &&
          !createsNote &&
          !redeemsLink &&
          !createsBoard &&
          !leavesBoard
        )
          headers['X-Expected-Revision'] = String(metadata.expectedRevision);
      }
      return fetch(buildUrl(path, options.query), { method, headers, body: encodedBody, signal });
    };
    let res = await doFetch(false);
    if (res.status === 401) res = await doFetch(true);
    assertCurrentSession(generation);
    // A board that is already gone (deleted from another tab, membership already removed, or
    // the retry of a request that did succeed) is the end state delete and leave ask for.
    if (res.status === 404 && (deletesBoard || leavesBoard))
      return { data: undefined as T, revision: metadata?.expectedRevision ?? 0 };
    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* response may have no JSON */
      }
      const message =
        body && typeof body === 'object' && 'message' in body ? String(body.message) : undefined;
      throw new ApiError(res.status, body, message);
    }
    const json = res.status === 204 ? undefined : await res.json();
    assertCurrentSession(generation);
    const parsed = schema && res.status !== 204 ? schema.safeParse(json) : null;
    if (parsed && !parsed.success)
      throw new ApiError(
        res.status,
        json,
        `Response failed schema validation: ${parsed.error.message}`,
      );
    const data = (parsed?.success ? parsed.data : json) as T;
    const header = res.headers.get('X-Resource-Revision');
    const revision = header === null ? (json?.revision as number | undefined) : Number(header);
    observeResponse(path, data, revision);
    return { data, revision: revision ?? metadata?.expectedRevision ?? 0 };
  };
  if (!isBoardMutation) return (await perform()).data;
  const ticket =
    options.ticket ??
    captureMutation(
      createsNote || redeemsLink || createsBoard ? `create:${crypto.randomUUID()}` : resource!,
      { advance: !path.endsWith('/duplicate') },
    );
  // Create carries no draft to recover, and the dialog shows its own error: no lane, no
  // unsaved-changes entry. It keeps the ticket's operation id, so a retry replays.
  if (createsBoard) return (await perform({ operationId: ticket.operationId })).data;
  const boardPath = `/whiteboards/${resource?.slice(6)}`;
  const reviewPath = resource?.startsWith('note:')
    ? `/notes/${resource.slice(5)}`
    : path.includes('/members')
      ? `${boardPath}/members`
      : path.includes('/share-link')
        ? `${boardPath}/share-link`
        : boardPath;
  return enqueueMutation(ticket, perform, {
    action: path.endsWith('/duplicate')
      ? 'duplicate'
      : path.includes('/subtasks')
        ? 'subtask'
        : path.includes('/members')
          ? 'member'
          : path.includes('/share-link')
            ? 'shareLink'
            : deletesBoard
              ? 'deleteBoard'
              : leavesBoard
                ? 'leaveBoard'
                : method === 'DELETE'
                  ? 'delete'
                  : path.endsWith('/move')
                    ? 'move'
                    : path.endsWith('/assign')
                      ? 'assign'
                      : path.endsWith('/complete')
                        ? 'complete'
                        : path.endsWith('/reopen')
                          ? 'reopen'
                          : createsNote
                            ? 'create'
                            : 'update',
    input: options.body ?? {},
    loadLatest: async () => {
      assertCurrentSession(generation);
      let data: unknown;
      try {
        data = await request<unknown>(reviewPath);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && (deletesBoard || leavesBoard))
          return { data: null, revision: 0 };
        if (!(
          error instanceof ApiError &&
          error.status === 404 &&
          reviewPath.endsWith('/share-link')
        ))
          throw error;
        const board = await request<{ revision: number }>(boardPath);
        return { data: null, revision: board.revision };
      }
      // The reviewed revision must belong to these exact values, never a later background read.
      const item = (Array.isArray(data) ? data[0] : data) as
        { boardRevision?: number; revision?: number } | undefined;
      const revision = item?.boardRevision ?? item?.revision ?? 0;
      const input = options.body as Record<string, unknown> | undefined;
      if (path.includes('/members/') && !path.endsWith('/invite') && Array.isArray(data)) {
        const member = data.find((row) => row.id === path.split('/').at(-1));
        return {
          data: member ?? null,
          revision,
          proposed: {
            name: member?.displayName ?? member?.email ?? i18n.t('safety.missingTarget'),
            ...input,
          },
        };
      }
      if (path.includes('/subtasks')) {
        const note = data as {
          title: string;
          subtasks: { id: string; text: string; done: boolean }[];
        };
        const task = note.subtasks.find((row) => row.id === path.split('/').at(-1));
        return {
          data: task
            ? { title: note.title, text: task.text, done: task.done }
            : { title: note.title },
          revision,
          proposed: { title: note.title, ...(task ? { text: task.text } : {}), ...input },
        };
      }
      if (path.endsWith('/assign')) {
        const note = data as { whiteboardId: string; title: string; assignee: unknown };
        const members = await request<
          { userId: string; displayName: string | null; email: string }[]
        >(`/whiteboards/${note.whiteboardId}/members`);
        const member = members.find((row) => row.userId === input?.assigneeId);
        return {
          data: { title: note.title, assignee: note.assignee },
          revision,
          proposed: {
            assignee:
              input?.assigneeId === null
                ? null
                : (member?.displayName ?? member?.email ?? i18n.t('safety.missingTarget')),
          },
        };
      }
      return { data, revision };
    },
  });
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>, query?: RequestOptions['query']) =>
    request(path, { method: 'GET', query }, schema),
  post: <T>(path: string, body: unknown, schema?: z.ZodType<T>, ticket?: MutationTicket) =>
    request(path, { method: 'POST', body, ticket }, schema),
  patch: <T>(path: string, body: unknown, schema?: z.ZodType<T>, ticket?: MutationTicket) =>
    request(path, { method: 'PATCH', body, ticket }, schema),
  delete: <T = void>(path: string, schema?: z.ZodType<T>, ticket?: MutationTicket) =>
    request(path, { method: 'DELETE', ticket }, schema),
};
