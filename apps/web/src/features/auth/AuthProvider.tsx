import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: User | null;
  idToken: string | null;
  status: AuthStatus;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  // Firebase can fire onAuthStateChanged before the token is attached; track it so we
  // never flip to "authenticated" without a usable token.
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        tokenRef.current = null;
        setUser(null);
        setIdToken(null);
        setStatus('unauthenticated');
        return;
      }
      try {
        const token = await firebaseUser.getIdToken();
        tokenRef.current = token;
        setUser(firebaseUser);
        setIdToken(token);
        setStatus('authenticated');
      } catch {
        setUser(null);
        setIdToken(null);
        setStatus('unauthenticated');
      }
    });
    return unsubscribe;
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, new GoogleAuthProvider());
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, idToken, status, signInWithEmail, signUpWithEmail, signInWithGoogle, signOut }),
    [user, idToken, status, signInWithEmail, signUpWithEmail, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/**
 * Fetches a fresh ID token on demand (forcing a refresh), for the API client to call
 * before a request or on a 401 retry. Not part of the context value itself — the API
 * client lives outside React and must not depend on component state.
 */
export async function getFreshIdToken(forceRefresh = false): Promise<string | null> {
  const current = auth.currentUser;
  if (!current) return null;
  return current.getIdToken(forceRefresh);
}
