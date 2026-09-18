import { Navigate } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { SignInForm } from '@/features/auth/SignInForm';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Navigate to="/" replace />;

  return (
    <AuthLayout title="Willkommen zurück" subtitle="Melde dich an, um deine Wand zu sehen.">
      <SignInForm />
    </AuthLayout>
  );
}
