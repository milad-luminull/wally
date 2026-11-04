import { describe, expect, it } from 'vitest';
import { AUTH0_TENANT_DOMAIN } from './constants.js';
import { createAuth0UserDeleter } from './management.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

function parseBody(body: RequestInit['body']): Record<string, unknown> | undefined {
  if (body == null) return undefined;
  const text = String(body);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

/** A fetch that answers the token request, then each delete with `deleteStatus`. */
function fakeFetch(deleteStatus = 204) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: parseBody(init?.body),
    });
    if (url.endsWith('/oauth/token'))
      return Response.json({ access_token: 'm2m-token', token_type: 'Bearer', expires_in: 86400 });
    return new Response(
      deleteStatus === 204 ? null : JSON.stringify({ statusCode: deleteStatus }),
      { status: deleteStatus, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const options = { clientId: 'client-id', clientSecret: 'client-secret' };
const tenant = `https://${AUTH0_TENANT_DOMAIN}`;

describe('the Auth0 user deleter', () => {
  it('gets a token for the Management API, then deletes the user', async () => {
    const { fetch, calls } = fakeFetch();
    await createAuth0UserDeleter({ ...options, fetch }).deleteUser('auth0|abc');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: `${tenant}/oauth/token`,
      method: 'POST',
      body: {
        grant_type: 'client_credentials',
        client_id: 'client-id',
        client_secret: 'client-secret',
        audience: `${tenant}/api/v2/`,
      },
    });
    expect(calls[1]).toMatchObject({
      url: `${tenant}/api/v2/users/auth0%7Cabc`,
      method: 'DELETE',
      headers: { authorization: 'Bearer m2m-token' },
    });
  });

  it('throws when Auth0 refuses, naming no credential', async () => {
    for (const status of [401, 404]) {
      const { fetch } = fakeFetch(status);
      const failure = createAuth0UserDeleter({ ...options, fetch }).deleteUser('auth0|abc');
      await expect(failure).rejects.toThrow();
      await expect(failure).rejects.not.toThrow(/m2m-token|client-secret/);
    }
  });

  it('reuses one token across deletions', async () => {
    const { fetch, calls } = fakeFetch();
    const deleter = createAuth0UserDeleter({ ...options, fetch });
    await deleter.deleteUser('auth0|one');
    await deleter.deleteUser('auth0|two');
    expect(calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
  });
});
