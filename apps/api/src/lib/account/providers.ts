import { randomUUID } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirebaseApp } from '../firebase-app.js';
import type { DeletionProviders } from './cleanup.js';

/** The only Management API scope the cleanup client may hold. */
export const CLEANUP_SCOPE = 'delete:users';

async function deleteFirebaseUser(userId: string) {
  await getAuth(getFirebaseApp()).deleteUser(userId);
}

/** Worker-only credentials; never put a Management API token into the web app or export. */
export function deletionProviders(
  config: {
    issuer: string;
    managementDomain: string;
    clientId: string;
    clientSecret: string;
  },
  request: typeof fetch = fetch,
  firebaseDelete: (userId: string) => Promise<void> = deleteFirebaseUser,
): DeletionProviders & { verifyAccess(): Promise<{ auth0Scope: string }> } {
  if (!/^[a-z0-9-]+\.(?:[a-z]+\.)?auth0\.com$/.test(config.managementDomain))
    throw new Error('Invalid Auth0 management domain');
  const origin = `https://${config.managementDomain}`;
  let token: { value: string; scope: unknown; expiresAt: number } | undefined;
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
    const data = (await response.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
      scope?: unknown;
    };
    if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number')
      throw new Error('Invalid Auth0 cleanup token');
    token = {
      value: data.access_token,
      scope: data.scope,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return token.value;
  }
  async function deleteFirebase(userId: string) {
    try {
      await firebaseDelete(userId);
    } catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
    }
  }
  return {
    deleteFirebase,
    /**
     * Release check, run inside the deployed worker. Proves the worker identity may delete
     * Firebase users (a random UID is never an existing account, so the provider answers
     * not-found only after authorizing the call) and that the injected Auth0 secret yields a
     * token with exactly the cleanup scope. Deletes nothing and returns no credential.
     */
    async verifyAccess() {
      await deleteFirebase(`wally-cleanup-check-${randomUUID()}`);
      await managementToken();
      if (token?.scope !== CLEANUP_SCOPE)
        throw new Error(`Auth0 cleanup client scope must be exactly ${CLEANUP_SCOPE}`);
      return { auth0Scope: CLEANUP_SCOPE };
    },
    async deleteAuth0(issuer, subject) {
      if (issuer !== config.issuer || !/^(auth0|google-oauth2)\|.+$/.test(subject))
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
