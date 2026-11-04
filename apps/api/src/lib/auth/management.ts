import { AUTH0_ISSUER, AUTH0_MANAGEMENT_AUDIENCE } from './constants.js';

/** Deletes a user in Auth0. Account deletion's only call to Auth0 (lib/account/erase.ts). */
export interface Auth0UserDeleter {
  deleteUser(subject: string): Promise<void>;
}

const TIMEOUT_MS = 10_000;

/**
 * A deleter for the machine-to-machine client allowed only `delete:users`. It asks for a new
 * token on every deletion: deletions are rare, and Free includes 1,000 such tokens a month.
 * Requests go to the custom domain; the token's audience is the tenant's default domain.
 */
export function createAuth0UserDeleter(options: {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}): Auth0UserDeleter {
  const fetchFn = options.fetch ?? fetch;
  return {
    async deleteUser(subject) {
      const tokenResponse = await fetchFn(new URL('oauth/token', AUTH0_ISSUER), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: options.clientId,
          client_secret: options.clientSecret,
          audience: AUTH0_MANAGEMENT_AUDIENCE,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!tokenResponse.ok)
        throw new Error(`Auth0 token request failed with status ${tokenResponse.status}`);
      const { access_token: token } = (await tokenResponse.json()) as { access_token: string };

      const response = await fetchFn(
        new URL(`api/v2/users/${encodeURIComponent(subject)}`, AUTH0_ISSUER),
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (response.status !== 204)
        throw new Error(`Auth0 user deletion failed with status ${response.status}`);
    },
  };
}
