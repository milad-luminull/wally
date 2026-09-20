import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import type { MessageKey } from '@/i18n/keys';
import { useAuth } from './AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Email/password format constraints are Firebase's own domain (it validates and returns
// a typed error itself) — no need for these to exist in @wally/shared.
/**
 * The messages are catalogue KEYS, not copy, and the schema stays at module scope.
 *
 * Resolving them here would freeze German at import time; resolving them into component state
 * would leave an already-displayed error stale after a language switch, because nothing re-runs
 * the code that produced it. Keeping keys in state and calling t() at the point of render
 * fixes both, and costs no useMemo.
 */
const signInSchema = z.object({
  email: z.string().trim().min(1, 'validation.email.required').email('validation.email.invalid'),
  password: z.string().min(1, 'validation.password.required'),
});

function authErrorKey(err: unknown): MessageKey {
  const code = (err as { code?: string } | undefined)?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'auth.errors.invalidCredential';
    case 'auth/too-many-requests':
      return 'auth.errors.tooManyRequests';
    case 'auth/popup-closed-by-user':
      return 'auth.errors.popupClosed';
    default:
      return 'auth.errors.signInFailed';
  }
}

export function SignInForm() {
  const { t } = useTranslation();
  const { signInWithEmail, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, MessageKey>>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [loading, setLoading] = useState<'email' | 'google' | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: Record<string, MessageKey> = {};
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0])] = issue.message as MessageKey;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setLoading('email');
    try {
      await signInWithEmail(parsed.data.email, parsed.data.password);
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(authErrorKey(err));
    } finally {
      setLoading(null);
    }
  }

  async function handleGoogle() {
    setFormError(null);
    setLoading('google');
    try {
      await signInWithGoogle();
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(authErrorKey(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signin-email">{t('auth.emailLabel')}</Label>
        <Input
          id="signin-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'signin-email-error' : undefined}
        />
        {fieldErrors.email && (
          <p id="signin-email-error" className="text-12 text-status-danger">
            {t(fieldErrors.email)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signin-password">{t('auth.passwordLabel')}</Label>
        <Input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? 'signin-password-error' : undefined}
        />
        {fieldErrors.password && (
          <p id="signin-password-error" className="text-12 text-status-danger">
            {t(fieldErrors.password)}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-13 text-status-danger">
          {t(formError)}
        </p>
      )}

      <Button type="submit" disabled={loading !== null}>
        {loading === 'email' ? t('auth.signIn.pending') : t('auth.signIn.submit')}
      </Button>

      <div className="flex items-center gap-3 text-12 text-fg-muted">
        <span className="h-px flex-1 bg-border" />
        {t('common.or')}
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button type="button" variant="outline" onClick={handleGoogle} disabled={loading !== null}>
        {loading === 'google' ? t('auth.googlePending') : t('auth.google')}
      </Button>

      <p className="text-center text-13 text-fg-muted">
        {t('auth.signIn.noAccount')}{' '}
        <Link
          to="/signup"
          state={{ from }}
          className="font-medium text-fg-1 underline-offset-4 hover:underline"
        >
          {t('auth.signIn.toSignUp')}
        </Link>
      </p>
    </form>
  );
}
