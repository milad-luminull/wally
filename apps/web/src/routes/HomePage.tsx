import { useAuth } from '@/features/auth/AuthProvider';
import { AppSkeleton } from '@/components/AppSkeleton';
import { LandingPage } from './LandingPage';
import { WelcomePage } from './WelcomePage';

export function HomePage() {
  const { status } = useAuth();
  if (status === 'loading') return <AppSkeleton />;
  return status === 'authenticated' ? <LandingPage /> : <WelcomePage />;
}
