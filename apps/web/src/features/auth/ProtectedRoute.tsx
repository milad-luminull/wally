import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from './AuthProvider';
import { Skeleton } from '@/components/ui/skeleton';

function FullPageSkeleton() {
  const { t } = useTranslation();

  return (
    <div className="flex h-screen flex-col gap-4 bg-background p-6" role="status" aria-label={t('common.loading')}>
      <div className="flex items-center gap-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="flex gap-4">
        <Skeleton className="h-64 flex-1" />
        <Skeleton className="h-64 flex-1" />
        <Skeleton className="h-64 flex-1" />
      </div>
    </div>
  );
}

/**
 * Shows a full-page skeleton while Firebase auth state resolves — never flashes the
 * login form — then redirects to /login (preserving the intended location) or renders
 * children once authenticated.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSkeleton />;

  if (status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  return <>{children}</>;
}
