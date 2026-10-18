import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { boardEntryWithReturn, readReturnPath } from '@/features/auth/returnPath';
import { SignUpForm } from '@/features/auth/SignUpForm';
import { AuthLayout } from './AuthLayout';

export function SignupPage() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const location = useLocation();
  // Navigate only after AuthProvider has a usable token. Form completion can precede
  // that notification; entering the protected route early would lose the return path.
  const target = boardEntryWithReturn(readReturnPath(location.state));
  if (status === 'authenticated')
    return <Navigate to={target.pathname} state={target.state} replace />;

  return (
    <AuthLayout title={t('routes.signup.title')} subtitle={t('routes.signup.subtitle')}>
      <SignUpForm />
    </AuthLayout>
  );
}
