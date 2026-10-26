import { getAuth } from 'firebase-admin/auth';
import { getFirebaseApp } from '../firebase-app.js';
import type { DeletionProviders } from './cleanup.js';

/** Worker-only credentials; never put a Management API token into the web app or export. */
export function deletionProviders(
  config: {
    issuer: string;
    managementDomain: string;
    clientId: string;
    clientSecret: string;
  },
  request: typeof fetch = fetch,
): DeletionProviders {
  if (!/^[a-z0-9-]+\.(?:[a-z]+\.)?auth0\.com$/.test(config.managementDomain))
    throw new Error('Invalid Auth0 management domain');
  const origin = `https://${config.managementDomain}`;
  let token: { value: string; expiresAt: number } | undefined;
  async function managementToken() {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const response = await request(`${origin}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        audience: `${origin}/api/v2/`,
      }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Auth0 cleanup authentication failed');
    const data = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number')
      throw new Error('Invalid Auth0 cleanup token');
    token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return token.value;
  }
  return {
    async deleteFirebase(userId) {
      try {
        await getAuth(getFirebaseApp()).deleteUser(userId);
      } catch (error) {
        if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
      }
    },
    async deleteAuth0(issuer, subject) {
      // Any Auth0 connection can sign in (the API accepts every verified subject), so any
      // must be deletable: Auth0 user IDs are always `<provider>|<id>`.
      if (issuer !== config.issuer || !/^[\w-]+\|.+$/.test(subject))
        throw new Error('Unverified Auth0 deletion target');
      const response = await request(`${origin}/api/v2/users/${encodeURIComponent(subject)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await managementToken()}` },
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      if (!response.ok && response.status !== 404)
        throw new Error('Auth0 identity cleanup pending');
    },
  };
}
