import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { landingWithReturn, readReturnPath } from '@/features/auth/returnPath';
import { SignUpForm } from '@/features/auth/SignUpForm';
import { AuthLayout } from './AuthLayout';

export function SignupPage() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const location = useLocation();
  // onAuthStateChanged can flip `status` before the form's own navigate runs, so this
  // redirect has to honour the intended destination too — otherwise it wins the race and
  // drops the share link the visitor arrived with.
  const target = landingWithReturn(readReturnPath(location.state));
  if (status === 'authenticated')
    return <Navigate to={target.pathname} state={target.state} replace />;

  return (
    <AuthLayout title={t('routes.signup.title')} subtitle={t('routes.signup.subtitle')}>
      <SignUpForm />
    </AuthLayout>
  );
}
