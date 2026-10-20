import { createContext } from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
/** Application identity; provider subjects must never be used for board ownership. */
export interface WallyUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
}
export interface AuthContextValue {
  user: WallyUser | null;
  idToken: string | null;
  status: AuthStatus;
  emailVerified: boolean;
  signedOut: boolean;
  expired: { unsaved: number } | null;
  verificationSendFailed: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshUser: () => Promise<boolean>;
  hostedLogin?: (signup: boolean, returnPath: string | null) => Promise<void>;
  authError?: 'migration' | 'unavailable' | null;
}
export const AuthContext = createContext<AuthContextValue | null>(null);
