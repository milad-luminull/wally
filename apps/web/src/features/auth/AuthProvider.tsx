import { useContext, type ReactNode } from 'react';

export type { AuthStatus } from './authContext';
import { AuthContext, type AuthContextValue } from './authContext';
import { Auth0SessionProvider } from './Auth0SessionProvider';
import { getAuth0AccessToken } from './auth0Session';

/** Signs people in through Auth0's hosted login, the only sign-in Wally has. */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <Auth0SessionProvider>{children}</Auth0SessionProvider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/**
 * Fetches a fresh access token on demand (forcing a refresh), for the API client to call
 * before a request or on a 401 retry. Not part of the context value itself — the API
 * client lives outside React and must not depend on component state.
 */
export async function getFreshIdToken(forceRefresh = false): Promise<string | null> {
  return getAuth0AccessToken(forceRefresh);
}
