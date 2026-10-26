import { Auth0Client } from '@auth0/auth0-spa-js';
import { meDtoSchema } from '@wally/shared';
import { readReturnPath } from './returnPath';

export interface Auth0ClientPort {
  checkSession(): Promise<void>;
  isAuthenticated(): Promise<boolean>;
  getUser(): Promise<{ sub?: string; email_verified?: boolean } | undefined>;
  getTokenSilently(options?: { cacheMode?: 'on' | 'off' }): Promise<string>;
  handleRedirectCallback(): Promise<{ appState?: { returnPath?: unknown } }>;
  loginWithRedirect(options: {
    appState: { returnPath: string | null };
    authorizationParams: {
      screen_hint?: 'signup';
      connection?: string;
      prompt?: 'login';
    };
  }): Promise<void>;
  logout(options: { logoutParams: { returnTo: string } }): Promise<void>;
}
export class SessionError extends Error {
  constructor(readonly code: 'IDENTITY_NOT_LINKED' | 'SESSION_UNAVAILABLE') {
    super(code);
  }
}
export function createAuth0Session(
  client: Auth0ClientPort,
  apiBase: string,
  fetcher: typeof fetch = fetch,
) {
  let initialization: Promise<{ callback: boolean; returnPath: string | null }> | undefined;
  const token = (force = false) => client.getTokenSilently({ cacheMode: force ? 'off' : 'on' });
  return {
    client,
    token,
    initialize(url: string) {
      initialization ??= (async () => {
        const params = new URL(url).searchParams;
        if (params.has('state') && (params.has('code') || params.has('error'))) {
          const result = await client.handleRedirectCallback();
          return {
            callback: true,
            returnPath: readReturnPath({ from: result.appState?.returnPath }),
          };
        }
        await client.checkSession();
        return { callback: false, returnPath: null };
      })();
      return initialization;
    },
    async load(force = false) {
      if (!(await client.isAuthenticated())) return null;
      const accessToken = await token(force);
      const response = await fetcher(`${apiBase}/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new SessionError(
          body?.error === 'IDENTITY_NOT_LINKED' ? 'IDENTITY_NOT_LINKED' : 'SESSION_UNAVAILABLE',
        );
      }
      const profile = meDtoSchema.parse(await response.json());
      const provider = await client.getUser();
      return {
        user: { uid: profile.id, email: profile.email, displayName: profile.displayName },
        accessToken,
        emailVerified: provider?.email_verified === true,
      };
    },
  };
}
export type Auth0Session = ReturnType<typeof createAuth0Session>;
let session: Auth0Session | undefined;
export function getAuth0Session(): Auth0Session {
  if (!session) {
    const client = new Auth0Client({
      domain: 'login.luminull.com',
      clientId: import.meta.env.VITE_AUTH0_CLIENT_ID || 'Ck830qbC3GVTQDL3W3ku4yRA43O1R5hp',
      authorizationParams: {
        audience: 'https://api.wally.luminull.com',
        redirect_uri: `${window.location.origin}/login`,
        scope: 'openid profile email offline_access',
      },
      cacheLocation: 'memory',
      useRefreshTokens: true,
      useRefreshTokensFallback: true,
    });
    session = createAuth0Session(
      {
        checkSession: () => client.checkSession(),
        isAuthenticated: () => client.isAuthenticated(),
        getUser: () => client.getUser(),
        getTokenSilently: async (options) => {
          const accessToken = await client.getTokenSilently(options);
          if (!accessToken) throw new SessionError('SESSION_UNAVAILABLE');
          return accessToken;
        },
        handleRedirectCallback: () => client.handleRedirectCallback(),
        loginWithRedirect: (options) => client.loginWithRedirect(options),
        logout: (options) => client.logout(options),
      },
      import.meta.env.VITE_API_BASE_URL,
    );
  }
  return session;
}
const terminalErrors = new Set([
  'login_required',
  'invalid_grant',
  'consent_required',
  'interaction_required',
]);
/** SDK OAuth errors that require interactive login; transport failures are retryable. */
export function isTerminalAuth0Error(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof error.error === 'string' &&
    terminalErrors.has(error.error)
  );
}
let tokenSource:
  { read: (force: boolean) => Promise<string>; onTerminalError?: () => void } | undefined;
export function registerAuth0TokenSource(
  source: (force: boolean) => Promise<string>,
  onTerminalError?: () => void,
) {
  const registration = { read: source, onTerminalError };
  tokenSource = registration;
  return () => {
    if (tokenSource === registration) tokenSource = undefined;
  };
}
export async function getAuth0AccessToken(force = false): Promise<string | null> {
  const current = tokenSource;
  if (!current) return null;
  try {
    const token = await current.read(force);
    return tokenSource === current ? token : null;
  } catch (error) {
    // A late error from a previous registration must never expire a newer session.
    if (tokenSource !== current) return null;
    if (isTerminalAuth0Error(error)) {
      tokenSource = undefined;
      current.onTerminalError?.();
    }
    throw error;
  }
}
