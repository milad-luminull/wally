import { useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useAuth } from './AuthProvider';
import { readReturnPath } from './returnPath';

export function HostedLogin({ signup = false }: { signup?: boolean }) {
  const { t } = useTranslation();
  const { hostedLogin, authError, signOut, status } = useAuth();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-13 text-fg-3">{t('auth.hosted.description')}</p>
      <p className="text-13 text-fg-3">{t('auth.hosted.passwordReset')}</p>
      {(authError || failed) && (
        <p role="alert" className="text-13 text-status-danger">
          {t(
            !failed && authError === 'migration'
              ? 'auth.hosted.migration'
              : 'auth.hosted.unavailable',
          )}
        </p>
      )}
      <Button
        size="lg"
        disabled={pending || status === 'loading'}
        onClick={() => void run(() => hostedLogin!(signup, readReturnPath(location.state)))}
      >
        {t(
          pending || status === 'loading'
            ? 'auth.hosted.pending'
            : signup
              ? 'auth.hosted.signup'
              : 'auth.hosted.login',
        )}
      </Button>
      {authError && (
        <Button variant="outline" disabled={pending} onClick={() => void run(signOut)}>
          {t('auth.hosted.switchAccount')}
        </Button>
      )}
    </div>
  );
}
