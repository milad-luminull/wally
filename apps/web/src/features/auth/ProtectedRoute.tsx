import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';
import { AppSkeleton } from '@/components/AppSkeleton';

/**
 * Shows a full-page skeleton while Firebase auth state resolves — never flashes the
 * login form — then redirects to /login (preserving the intended location) or renders
 * children once authenticated.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <AppSkeleton />;

  if (status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  return <>{children}</>;
}
