import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';
import { AppSkeleton } from '@/components/AppSkeleton';

/**
 * Shows a full-page skeleton while Firebase auth state resolves — never flashes the
 * login form — then redirects to /login or renders children once authenticated.
 *
 * The intended location goes along to /login only for a visitor who arrived signed out. After
 * a sign-out it belonged to the previous account, and handing it to whoever signs in next
 * sent them to a board they cannot see.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, signedOut } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <AppSkeleton />;

  if (status === 'unauthenticated') {
    return (
      <Navigate
        to="/login"
        state={signedOut ? null : { from: location.pathname + location.search }}
        replace
      />
    );
  }

  return <>{children}</>;
}
