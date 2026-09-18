import { Navigate } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { SignUpForm } from '@/features/auth/SignUpForm';
import { AuthLayout } from './AuthLayout';

export function SignupPage() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Navigate to="/" replace />;

  return (
    <AuthLayout title="Konto erstellen" subtitle="Lege dein persönliches Whiteboard an.">
      <SignUpForm />
    </AuthLayout>
  );
}
