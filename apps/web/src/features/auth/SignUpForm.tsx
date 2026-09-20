import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { useAuth } from './AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const signUpSchema = z
  .object({
    email: z.string().trim().min(1, 'E-Mail ist erforderlich').email('Ungültige E-Mail-Adresse'),
    password: z.string().min(8, 'Mindestens 8 Zeichen'),
    passwordConfirm: z.string().min(1, 'Bitte Passwort bestätigen'),
  })
  .refine((val) => val.password === val.passwordConfirm, {
    message: 'Passwörter stimmen nicht überein',
    path: ['passwordConfirm'],
  });

function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string } | undefined)?.code;
  switch (code) {
    case 'auth/email-already-in-use':
      return 'Für diese E-Mail-Adresse besteht bereits ein Konto.';
    case 'auth/weak-password':
      return 'Das Passwort ist zu schwach.';
    case 'auth/popup-closed-by-user':
      return 'Anmeldung abgebrochen.';
    default:
      return 'Registrierung fehlgeschlagen. Bitte erneut versuchen.';
  }
}

export function SignUpForm() {
  const { signUpWithEmail, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Carried through from ProtectedRoute, same as SignInForm. Without it a new user who
  // opens a share link and picks "Registrieren" lands on their own empty board and the
  // token is gone from history.
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState<'email' | 'google' | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = signUpSchema.safeParse({ email, password, passwordConfirm });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) errors[String(issue.path[0])] = issue.message;
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setLoading('email');
    try {
      await signUpWithEmail(parsed.data.email, parsed.data.password);
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(friendlyAuthError(err));
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
      setFormError(friendlyAuthError(err));
    } finally {
      setLoading(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-email">E-Mail</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'signup-email-error' : undefined}
        />
        {fieldErrors.email && (
          <p id="signup-email-error" className="text-12 text-status-danger">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-password">Passwort</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? 'signup-password-error' : undefined}
        />
        {fieldErrors.password && (
          <p id="signup-password-error" className="text-12 text-status-danger">
            {fieldErrors.password}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-password-confirm">Passwort bestätigen</Label>
        <Input
          id="signup-password-confirm"
          type="password"
          autoComplete="new-password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          aria-invalid={Boolean(fieldErrors.passwordConfirm)}
          aria-describedby={fieldErrors.passwordConfirm ? 'signup-password-confirm-error' : undefined}
        />
        {fieldErrors.passwordConfirm && (
          <p id="signup-password-confirm-error" className="text-12 text-status-danger">
            {fieldErrors.passwordConfirm}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-13 text-status-danger">
          {formError}
        </p>
      )}

      <Button type="submit" disabled={loading !== null}>
        {loading === 'email' ? 'Registrieren…' : 'Registrieren'}
      </Button>

      <div className="flex items-center gap-3 text-12 text-fg-muted">
        <span className="h-px flex-1 bg-border" />
        oder
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button type="button" variant="outline" onClick={handleGoogle} disabled={loading !== null}>
        {loading === 'google' ? 'Verbinde…' : 'Mit Google anmelden'}
      </Button>

      <p className="text-center text-13 text-fg-muted">
        Schon ein Konto?{' '}
        <Link to="/login" state={{ from }} className="font-medium text-fg-1 underline-offset-4 hover:underline">
          Anmelden
        </Link>
      </p>
    </form>
  );
}
