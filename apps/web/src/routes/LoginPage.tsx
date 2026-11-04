import { useEffect, useState } from 'react';
import { HostedLogin } from '@/features/auth/HostedLogin';
import { ACCOUNT_DELETED_FLAG } from '@/features/account/DeleteAccountDialog';
import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { boardEntryWithReturn, readReturnPath } from '@/features/auth/returnPath';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { t } = useTranslation();
  const { status, expired } = useAuth();
  const location = useLocation();
  // Read once, cleared after render: the message shows on the page the deletion lands on.
  const [deleted] = useState(() => {
    try {
      return sessionStorage.getItem(ACCOUNT_DELETED_FLAG) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.removeItem(ACCOUNT_DELETED_FLAG);
    } catch {
      /* Storage blocked. */
    }
  }, []);
  // Navigate only after AuthProvider has a usable token; entering the protected route
  // early would lose the return path.
  const target = boardEntryWithReturn(readReturnPath(location.state));
  if (status === 'authenticated')
    return <Navigate to={target.pathname} state={target.state} replace />;

  return (
    <AuthLayout title={t('routes.login.title')} subtitle={t('routes.login.subtitle')}>
      {deleted && (
        <p role="status" className="rounded-md bg-inset px-3 py-2 text-13 text-fg-2">
          {t('accountData.deleted')}
        </p>
      )}
      {expired && (
        <p role="status" className="rounded-md bg-inset px-3 py-2 text-13 text-fg-2">
          {expired.unsaved > 0
            ? t('auth.sessionEndedUnsaved', { count: expired.unsaved })
            : t('auth.sessionEnded')}
        </p>
      )}
      <HostedLogin />
    </AuthLayout>
  );
}
