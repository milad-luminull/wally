import { Navigate, useLocation } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { SignInForm } from '@/features/auth/SignInForm';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { status } = useAuth();
  const location = useLocation();
  // onAuthStateChanged can flip `status` before the form's own navigate runs, so this
  // redirect has to honour the intended destination too — otherwise it wins the race and
  // drops the share link the visitor arrived with.
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (status === 'authenticated') return <Navigate to={from} replace />;

  return (
    <AuthLayout title="Willkommen zurück" subtitle="Melde dich an, um deine Wand zu sehen.">
      <SignInForm />
    </AuthLayout>
  );
}
