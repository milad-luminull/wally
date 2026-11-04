import { describe, expect, it } from 'vitest';
import { AUTH0_MANAGEMENT_AUDIENCE } from './constants.js';
import { createAuth0UserDeleter } from './management.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that answers the token request, then each delete with `deleteStatus`. */
function fakeFetch(deleteStatus = 204) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith('/oauth/token'))
      return Response.json({ access_token: 'm2m-token', token_type: 'Bearer', expires_in: 86400 });
    return new Response(null, { status: deleteStatus });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const options = { clientId: 'client-id', clientSecret: 'client-secret' };

describe('the Auth0 user deleter', () => {
  it('gets a token, then deletes the user', async () => {
    const { fetch, calls } = fakeFetch();
    await createAuth0UserDeleter({ ...options, fetch }).deleteUser('auth0|abc');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: 'https://login.luminull.com/oauth/token',
      method: 'POST',
      body: {
        grant_type: 'client_credentials',
        client_id: 'client-id',
        client_secret: 'client-secret',
        audience: AUTH0_MANAGEMENT_AUDIENCE,
      },
    });
    expect(calls[1]).toMatchObject({
      url: 'https://login.luminull.com/api/v2/users/auth0%7Cabc',
      method: 'DELETE',
      headers: { authorization: 'Bearer m2m-token' },
    });
  });

  it('throws on any answer but 204, naming the status and no credential', async () => {
    for (const status of [404, 500]) {
      const { fetch } = fakeFetch(status);
      const failure = createAuth0UserDeleter({ ...options, fetch }).deleteUser('auth0|abc');
      await expect(failure).rejects.toThrow(String(status));
      await expect(failure).rejects.not.toThrow(/m2m-token|client-secret/);
    }
  });

  it('asks for a new token on every deletion', async () => {
    const { fetch, calls } = fakeFetch();
    const deleter = createAuth0UserDeleter({ ...options, fetch });
    await deleter.deleteUser('auth0|one');
    await deleter.deleteUser('auth0|two');
    expect(calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(2);
  });
});
