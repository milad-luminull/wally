import type { z } from 'zod';
import { getFreshIdToken } from '@/features/auth/AuthProvider';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export type ApiErrorKind = 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'other';

/** Typed error the TanStack Query hooks can branch on (e.g. redirect to /login on 401). */
export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.kind = classify(status);
  }
}

function classify(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 422) return 'validation';
  return 'other';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
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
async function request<T>(path: string, options: RequestOptions = {}, schema?: z.ZodType<T>): Promise<T> {
  const doFetch = async (forceRefresh: boolean) => {
    const token = await getFreshIdToken(forceRefresh);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    return fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  };

  let res = await doFetch(false);
  if (res.status === 401) {
    // Token may have expired between page load and this call — refresh once and retry.
    res = await doFetch(true);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // no JSON body
    }
    const message = body && typeof body === 'object' && 'message' in body ? String(body.message) : undefined;
    throw new ApiError(res.status, body, message);
  }

  if (res.status === 204) return undefined as T;

  const json = await res.json();
  if (!schema) return json as T;

  // Parsing every response through the shared Zod schema means a backend shape drift
  // fails loudly here in dev instead of silently flowing into components as `any`.
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(res.status, json, `Response failed schema validation for ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>, query?: RequestOptions['query']) =>
    request(path, { method: 'GET', query }, schema),
  post: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
    request(path, { method: 'POST', body }, schema),
  patch: <T>(path: string, body: unknown, schema?: z.ZodType<T>) =>
    request(path, { method: 'PATCH', body }, schema),
  delete: <T = void>(path: string, schema?: z.ZodType<T>) => request(path, { method: 'DELETE' }, schema),
};
